"""Delegate to an OpenAI-compatible ``chat/completions`` endpoint.

Only an explicit, structurally valid verification result can become verified;
plain assistant prose and truncated responses fail closed. Mirrors the
TypeScript adapter.
"""

from __future__ import annotations

import json
import time
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Literal, Protocol, cast
from urllib.parse import urlsplit

import httpx

from agent_voice_worker.adapters.types import ActionContext, AdapterRequest, AdapterResult
from agent_voice_worker.protocol.events import FailureCode, Verification
from agent_voice_worker.protocol.limits import LIMITS

DEFAULT_SYSTEM_PROMPT = (
    "You are the execution agent behind a voice assistant. Perform the task using your normal "
    "tools and approval policy. Return one JSON object only: no Markdown fence or commentary. "
    "Its exact top-level keys are status, summary, and verification. Status must be verified, "
    "failed, unavailable, or cancelled. Verification has state and method, plus optional detail. "
    'Use status "verified" only after verifying the underlying action, with state "verified" '
    'and a concrete method. Every other status requires state "unverified". Never treat a '
    "completion sentence as proof."
)

DEFAULT_SESSION_HEADER = "X-Session-Key"
DEFAULT_TIMEOUT_SECONDS = 60.0
DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024
MAX_REQUEST_BYTES = 64 * 1024


class AdapterLogger(Protocol):
    """Structured, redaction-safe logging: event names and scalar fields only."""

    def warn(self, event: str, fields: Mapping[str, str | int | bool] | None = None) -> None: ...


@dataclass(frozen=True, slots=True)
class OpenAiHttpAdapterOptions:
    """Base URL of an OpenAI-compatible API, e.g. `http://127.0.0.1:8642/v1`.
    Server-side only."""

    endpoint: str
    model: str
    """Never logged, never echoed."""
    api_key: str | None = None
    """Header that carries the stable session key."""
    session_header: str = DEFAULT_SESSION_HEADER
    """Upper bound for the HTTP round-trip, further capped by the action deadline."""
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS
    """Upper bound for the response body in bytes."""
    max_response_bytes: int = DEFAULT_MAX_RESPONSE_BYTES
    system_prompt: str = DEFAULT_SYSTEM_PROMPT
    """Injectable for deterministic tests; owns its own transport otherwise."""
    client: httpx.AsyncClient | None = None
    logger: AdapterLogger | None = None


@dataclass(frozen=True, slots=True)
class _Ok:
    kind: Literal["ok"] = field(default="ok", init=False)
    result: AdapterResult


@dataclass(frozen=True, slots=True)
class _Fail:
    status: Literal["failed", "unavailable", "cancelled"]
    code: FailureCode
    kind: Literal["fail"] = field(default="fail", init=False)


_Outcome = _Ok | _Fail


def _normalise_endpoint(endpoint: str) -> str:
    try:
        parsed = urlsplit(endpoint)
    except ValueError as error:
        raise ValueError("agent endpoint must be an absolute http(s) URL") from error
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("agent endpoint must use http or https")
    return endpoint.rstrip("/")


def _extract_text(content: object) -> str | None:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return None
    parts: list[str] = []
    for part in content:
        if (
            isinstance(part, dict)
            and part.get("type") == "text"
            and isinstance(part.get("text"), str)
        ):
            parts.append(part["text"])
    return "".join(parts)


def _parse_agent_result(text: str, *, truncated: bool) -> AdapterResult | None:
    if truncated:
        return None
    try:
        value = json.loads(text)
    except (ValueError, RecursionError):
        return None
    if not isinstance(value, dict) or set(value) != {"status", "summary", "verification"}:
        return None

    status = value.get("status")
    summary_value = value.get("summary")
    verification_value = value.get("verification")
    if (
        not isinstance(status, str)
        or status not in {"verified", "failed", "unavailable", "cancelled"}
        or not isinstance(summary_value, str)
        or not (summary := summary_value.strip())
        or len(summary) > LIMITS.max_text_chars
        or not isinstance(verification_value, dict)
        or not set(verification_value).issubset({"state", "method", "detail"})
        or not {"state", "method"}.issubset(verification_value)
    ):
        return None

    state = verification_value.get("state")
    method_value = verification_value.get("method")
    has_detail = "detail" in verification_value
    detail = verification_value.get("detail")
    if (
        not isinstance(state, str)
        or state not in {"verified", "unverified"}
        or not isinstance(method_value, str)
        or not (method := method_value.strip())
        or len(method) > LIMITS.max_label_chars
        or (has_detail and (not isinstance(detail, str) or len(detail) > 1000))
        or ((status == "verified") != (state == "verified"))
    ):
        return None

    return AdapterResult(
        status=cast(Literal["verified", "failed", "unavailable", "cancelled"], status),
        summary=summary,
        verification=Verification(
            state=cast(Literal["verified", "unverified"], state),
            method=method,
            detail=detail,
        ),
        artifacts=[],
        retryable=status == "unavailable",
    )


def _now_ms() -> float:
    return time.time() * 1000


def _error_class(error: BaseException) -> str:
    return type(error).__name__


class OpenAiHttpAdapter:
    name = "openai-http"

    def __init__(self, options: OpenAiHttpAdapterOptions) -> None:
        self._endpoint = _normalise_endpoint(options.endpoint)
        key = (options.api_key or "").strip()
        self._api_key = key or None
        self._model = options.model
        self._session_header = options.session_header
        self._timeout_seconds = options.timeout_seconds
        self._max_response_bytes = options.max_response_bytes
        self._system_prompt = options.system_prompt
        self._client = options.client if options.client is not None else httpx.AsyncClient()
        self._logger = options.logger

    def _warn(self, event: str, fields: Mapping[str, str | int | bool] | None = None) -> None:
        if self._logger is not None:
            self._logger.warn(event, fields)

    async def run(self, request: AdapterRequest, context: ActionContext) -> AdapterResult:
        outcome = await self._call(request, context)
        if isinstance(outcome, _Ok):
            return outcome.result
        return AdapterResult(
            status=outcome.status,
            code=outcome.code,
            summary="",
            verification=Verification(state="unverified", method="openai-http:response"),
            artifacts=[],
            retryable=outcome.status == "unavailable",
        )

    async def _call(self, request: AdapterRequest, context: ActionContext) -> _Outcome:
        if context.cancelled():
            return _Fail(status="cancelled", code="cancelled")

        text = request.text[: LIMITS.max_text_chars]
        payload = {
            "model": self._model,
            "stream": False,
            "user": request.session_key,
            "messages": [
                {"role": "system", "content": self._system_prompt},
                {"role": "user", "content": text},
            ],
        }
        body = json.dumps(payload)
        if len(body.encode("utf-8")) > MAX_REQUEST_BYTES:
            return _Fail(status="failed", code="invalid")

        headers = {
            "content-type": "application/json",
            "accept": "application/json",
            self._session_header: request.session_key,
        }
        if self._api_key is not None:
            headers["authorization"] = f"Bearer {self._api_key}"

        budget = max(0.0, min(self._timeout_seconds, (context.deadline - _now_ms()) / 1000))

        try:
            async with self._client.stream(
                "POST",
                f"{self._endpoint}/chat/completions",
                content=body.encode("utf-8"),
                headers=headers,
                timeout=budget,
            ) as response:
                if response.status_code >= 400:
                    self._warn("openai_http.http_error", {"status": response.status_code})
                    await response.aclose()
                    unavailable = response.status_code >= 500 or response.status_code == 429
                    return _Fail(
                        status="unavailable" if unavailable else "failed",
                        code="unavailable" if unavailable else "failed",
                    )

                declared = response.headers.get("content-length")
                if declared is not None:
                    try:
                        declared_bytes = int(declared)
                    except ValueError:
                        declared_bytes = 0
                    if declared_bytes > self._max_response_bytes:
                        await response.aclose()
                        self._warn(
                            "openai_http.response_too_large", {"limit": self._max_response_bytes}
                        )
                        return _Fail(status="failed", code="invalid")

                chunks: list[bytes] = []
                total = 0
                async for chunk in response.aiter_bytes():
                    total += len(chunk)
                    if total > self._max_response_bytes:
                        await response.aclose()
                        self._warn(
                            "openai_http.response_too_large", {"limit": self._max_response_bytes}
                        )
                        return _Fail(status="failed", code="invalid")
                    chunks.append(chunk)
                raw = b"".join(chunks)
        except httpx.TimeoutException:
            if context.cancelled():
                return _Fail(status="cancelled", code="cancelled")
            return _Fail(status="unavailable", code="timeout")
        except httpx.HTTPError as error:
            if context.cancelled():
                return _Fail(status="cancelled", code="cancelled")
            self._warn("openai_http.transport_error", {"error": _error_class(error)})
            return _Fail(status="unavailable", code="unavailable")

        try:
            decoded = raw.decode("utf-8")
            parsed = json.loads(decoded)
        except (UnicodeDecodeError, ValueError, RecursionError):
            self._warn("openai_http.malformed_response")
            return _Fail(status="failed", code="failed")

        choices = parsed.get("choices") if isinstance(parsed, dict) else None
        choice = choices[0] if isinstance(choices, list) and choices else None
        message = choice.get("message") if isinstance(choice, dict) else None
        content = message.get("content") if isinstance(message, dict) else None
        extracted = _extract_text(content)
        trimmed = (extracted or "").strip()
        if not trimmed:
            self._warn("openai_http.empty_response")
            return _Fail(status="failed", code="failed")

        finish_reason = choice.get("finish_reason") if isinstance(choice, dict) else None
        result = _parse_agent_result(trimmed, truncated=finish_reason == "length")
        if result is None:
            self._warn("openai_http.invalid_agent_result")
            return _Fail(status="failed", code="invalid")
        return _Ok(result=result)
