"""Mirrors `packages/adapter-openai-http/test/openai-http-adapter.test.ts`."""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from typing import Any

import httpx
import pytest

from agent_voice_worker.adapters.openai_http import (
    DEFAULT_SYSTEM_PROMPT,
    OpenAiHttpAdapter,
    OpenAiHttpAdapterOptions,
)
from agent_voice_worker.adapters.types import ActionContext, AdapterRequest
from agent_voice_worker.protocol.artifacts import Artifact
from agent_voice_worker.protocol.limits import LIMITS

# Deliberately not shaped like a real provider key so the repository secret
# scanner stays strict; the tests only need a distinctive string to assert on.
SECRET = "test-bearer-DO-NOT-LOG-1234567890"

REQUEST = AdapterRequest(
    conversation_id="conv_1",
    action_id="act_1",
    text="Summarize the nightly build failures",
    session_key="session-abc",
)

Handler = Callable[[httpx.Request], httpx.Response]


def context(*, cancelled: bool = False, deadline: float | None = None) -> ActionContext:
    async def request_approval(_request: object) -> Any:
        return "approved"

    return ActionContext(
        cancelled=lambda: cancelled,
        deadline=deadline if deadline is not None else time.time() * 1000 + 10_000,
        progress=lambda _message, _percent: None,
        artifact=lambda _artifact: None,
        request_approval=request_approval,  # type: ignore[arg-type]
    )


def json_response(
    body: object, status: int = 200, headers: dict[str, str] | None = None
) -> httpx.Response:
    return httpx.Response(status, json=body, headers=headers)


def completion(content: object, finish_reason: str = "stop") -> dict[str, object]:
    return {
        "id": "chatcmpl-1",
        "object": "chat.completion",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": finish_reason,
            }
        ],
    }


def verified_result(summary: str) -> str:
    return json.dumps(
        {
            "status": "verified",
            "summary": summary,
            "verification": {"state": "verified", "method": "agent:tool-check"},
        }
    )


class RecordingLogger:
    def __init__(self) -> None:
        self.lines: list[str] = []

    def warn(self, event: str, fields: dict[str, str | int | bool] | None = None) -> None:
        self.lines.append(json.dumps({"event": event, **(fields or {})}))


def adapter_with(
    handler: Handler, **extra: object
) -> tuple[OpenAiHttpAdapter, RecordingLogger, list[httpx.Request]]:
    calls: list[httpx.Request] = []

    def recording_handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return handler(request)

    logger = RecordingLogger()
    client = httpx.AsyncClient(transport=httpx.MockTransport(recording_handler))
    options: dict[str, object] = {
        "endpoint": "http://127.0.0.1:8642/v1/",
        "api_key": SECRET,
        "model": "hermes-local",
        "client": client,
        "logger": logger,
    }
    options.update(extra)
    adapter = OpenAiHttpAdapter(OpenAiHttpAdapterOptions(**options))  # type: ignore[arg-type]
    return adapter, logger, calls


async def test_posts_a_bounded_non_streaming_chat_completion_with_bearer_and_session_headers() -> (
    None
):
    adapter, _logger, calls = adapter_with(
        lambda _req: json_response(completion(verified_result("Two jobs failed.")))
    )

    result = await adapter.run(REQUEST, context())

    assert result.status == "verified"
    assert result.summary == "Two jobs failed."
    assert result.verification.state == "verified"
    assert len(calls) == 1
    call = calls[0]
    assert str(call.url) == "http://127.0.0.1:8642/v1/chat/completions"
    assert call.method == "POST"
    assert call.headers["authorization"] == f"Bearer {SECRET}"
    assert call.headers["x-session-key"] == "session-abc"
    assert call.headers["content-type"] == "application/json"
    body = json.loads(call.content)
    assert body["model"] == "hermes-local"
    assert body["stream"] is False
    assert body["user"] == "session-abc"
    assert body["messages"][-1] == {"role": "user", "content": REQUEST.text}
    assert body["messages"][0] == {"role": "system", "content": DEFAULT_SYSTEM_PROMPT}


async def test_omits_the_authorization_header_when_no_key_is_configured_and_honours_a_custom_session_header() -> (
    None
):
    adapter, _logger, calls = adapter_with(
        lambda _req: json_response(completion("ok")),
        api_key=None,
        session_header="X-Agent-Session",
    )
    await adapter.run(REQUEST, context())
    call = calls[0]
    assert "authorization" not in call.headers
    assert call.headers["x-agent-session"] == "session-abc"


async def test_accepts_structured_result_json_split_across_list_of_parts_content() -> None:
    result_json = verified_result("First part. Second part.")
    midpoint = len(result_json) // 2
    adapter, _logger, _calls = adapter_with(
        lambda _req: json_response(
            completion(
                [
                    {"type": "text", "text": result_json[:midpoint]},
                    {"type": "image_url", "image_url": {"url": "https://example.com/x.png"}},
                    {"type": "text", "text": result_json[midpoint:]},
                ]
            )
        )
    )
    result = await adapter.run(REQUEST, context())
    assert result.status == "verified"
    assert result.summary == "First part. Second part."


async def test_never_treats_unstructured_assistant_prose_as_verified_action_evidence() -> None:
    adapter, _logger, _calls = adapter_with(lambda _req: json_response(completion("Done.")))
    result = await adapter.run(REQUEST, context())
    assert result.status == "failed"
    assert result.verification.state == "unverified"


@pytest.mark.parametrize(
    "payload",
    [
        {
            "status": "verified",
            "summary": "Done.",
            "verification": {"state": "unverified", "method": "agent:check"},
        },
        {
            "status": "failed",
            "summary": "Failed.",
            "verification": {"state": "verified", "method": "agent:check"},
        },
        {
            "status": "verified",
            "summary": "Done.",
            "verification": {"state": "verified", "method": "agent:check"},
            "extra": True,
        },
        {
            "status": "verified",
            "summary": "Done.",
            "verification": {"state": "verified", "method": "agent:check", "extra": True},
        },
        {
            "status": "verified",
            "summary": "Done.",
            "verification": {"state": "verified", "method": "   "},
        },
        {
            "status": "verified",
            "summary": "x" * (LIMITS.max_text_chars + 1),
            "verification": {"state": "verified", "method": "agent:check"},
        },
        {
            "status": "verified",
            "summary": "Done.",
            "verification": {"state": "verified", "method": "agent:check", "detail": "x" * 1001},
        },
        {
            "status": "verified",
            "summary": "Done.",
            "verification": {"state": "verified", "method": "agent:check", "detail": None},
        },
        {
            "status": ["failed"],
            "summary": "Failed.",
            "verification": {"state": "unverified", "method": "agent:check"},
        },
        {
            "status": "failed",
            "summary": "Failed.",
            "verification": {"state": ["unverified"], "method": "agent:check"},
        },
    ],
)
async def test_fails_closed_on_invalid_structured_results(payload: dict[str, object]) -> None:
    adapter, _logger, _calls = adapter_with(
        lambda _req: json_response(completion(json.dumps(payload)))
    )
    result = await adapter.run(REQUEST, context())
    assert result.status == "failed"
    assert result.code == "invalid"
    assert result.verification.state == "unverified"


async def test_preserves_an_explicit_structured_unavailable_result_without_promoting_it() -> None:
    payload = json.dumps(
        {
            "status": "unavailable",
            "summary": "The action service is unavailable.",
            "verification": {"state": "unverified", "method": "agent:service-check"},
        }
    )
    adapter, _logger, _calls = adapter_with(lambda _req: json_response(completion(payload)))
    result = await adapter.run(REQUEST, context())
    assert result.status == "unavailable"
    assert result.summary == "The action service is unavailable."
    assert result.verification.state == "unverified"
    assert result.retryable is True


async def test_fails_closed_on_deeply_nested_inner_json() -> None:
    nested = "[" * 2000 + "]" * 2000
    adapter, _logger, _calls = adapter_with(lambda _req: json_response(completion(nested)))
    result = await adapter.run(REQUEST, context())
    assert result.status == "failed"
    assert result.code == "invalid"
    assert result.verification.state == "unverified"


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (500, "unavailable"),
        (502, "unavailable"),
        (503, "unavailable"),
        (429, "unavailable"),
        (401, "failed"),
        (403, "failed"),
        (400, "failed"),
        (404, "failed"),
    ],
)
async def test_maps_http_status_without_leaking_the_body(status: int, expected: str) -> None:
    adapter, logger, _calls = adapter_with(
        lambda _req: httpx.Response(
            status, content=f'{{"error":"upstream detail {SECRET}"}}'.encode()
        )
    )
    result = await adapter.run(REQUEST, context())
    assert result.status == expected
    assert result.verification.state == "unverified"
    dump = json.dumps(
        {
            "status": result.status,
            "summary": result.summary,
            "code": result.code,
            "detail": result.verification.detail,
        }
    )
    assert SECRET not in dump
    assert "upstream detail" not in dump
    joined = "\n".join(logger.lines)
    assert SECRET not in joined
    assert "upstream detail" not in joined


async def test_treats_transport_errors_as_unavailable_and_logs_only_the_error_class() -> None:
    def handler(_req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(f"connect ECONNREFUSED 127.0.0.1:8642 {SECRET}")

    adapter, logger, _calls = adapter_with(handler)
    result = await adapter.run(REQUEST, context())
    assert result.status == "unavailable"
    assert result.retryable is True
    assert "ECONNREFUSED" not in json.dumps(
        {"summary": result.summary, "detail": result.verification.detail}
    )
    assert any("ConnectError" in line for line in logger.lines)
    joined = "\n".join(logger.lines)
    assert SECRET not in joined
    assert "ECONNREFUSED" not in joined


async def test_fails_closed_on_a_declared_oversized_response() -> None:
    adapter, _logger, _calls = adapter_with(
        lambda _req: httpx.Response(
            200, content=b"{}", headers={"content-length": str(10 * 1024 * 1024)}
        ),
        max_response_bytes=1024,
    )
    result = await adapter.run(REQUEST, context())
    assert result.status == "failed"
    assert result.code == "invalid"


async def test_fails_closed_on_a_streamed_oversized_response() -> None:
    adapter, _logger, _calls = adapter_with(
        lambda _req: json_response(completion("x" * 5000)),
        max_response_bytes=1024,
    )
    result = await adapter.run(REQUEST, context())
    assert result.status == "failed"
    assert result.code == "invalid"


async def test_fails_on_malformed_json() -> None:
    adapter, _logger, _calls = adapter_with(lambda _req: httpx.Response(200, content=b"not json"))
    result = await adapter.run(REQUEST, context())
    assert result.status == "failed"


async def test_fails_on_whitespace_only_completion() -> None:
    adapter, _logger, _calls = adapter_with(lambda _req: json_response(completion("   ")))
    result = await adapter.run(REQUEST, context())
    assert result.status == "failed"


async def test_fails_on_empty_choices() -> None:
    adapter, _logger, _calls = adapter_with(lambda _req: json_response({"choices": []}))
    result = await adapter.run(REQUEST, context())
    assert result.status == "failed"


@pytest.mark.parametrize("message", [None, "not-an-object"])
async def test_fails_closed_when_the_completion_message_is_not_an_object(message: object) -> None:
    adapter, _logger, _calls = adapter_with(
        lambda _req: json_response({"choices": [{"message": message, "finish_reason": "stop"}]})
    )
    result = await adapter.run(REQUEST, context())
    assert result.status == "failed"
    assert result.verification.state == "unverified"


async def test_reports_cancelled_when_the_context_is_already_cancelled() -> None:
    adapter, _logger, calls = adapter_with(lambda _req: json_response(completion("too late")))
    result = await adapter.run(REQUEST, context(cancelled=True))
    assert result.status == "cancelled"
    assert calls == []


async def test_refuses_non_http_endpoints_at_construction() -> None:
    with pytest.raises(ValueError, match="http"):
        OpenAiHttpAdapter(
            OpenAiHttpAdapterOptions(
                endpoint="ftp://agent.local/v1", model="m", client=httpx.AsyncClient()
            )
        )
    with pytest.raises(ValueError):
        OpenAiHttpAdapter(
            OpenAiHttpAdapterOptions(endpoint="not a url", model="m", client=httpx.AsyncClient())
        )


async def test_never_verifies_a_truncated_completion() -> None:
    adapter, _logger, _calls = adapter_with(
        lambda _req: json_response(completion(verified_result("Partial answer"), "length"))
    )
    result = await adapter.run(REQUEST, context())
    assert result.status == "failed"
    assert result.verification.state == "unverified"


async def test_bounds_the_request_body_before_sending_it() -> None:
    called = False

    def handler(_req: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return json_response(completion(verified_result("ok")))

    adapter, _logger, _calls = adapter_with(handler)
    oversized = AdapterRequest(
        conversation_id="conv_1",
        action_id="act_1",
        text="x" * (LIMITS.max_text_chars + 1),
        session_key="session-abc",
    )
    result = await adapter.run(oversized, context())
    assert called is True
    assert result.status == "verified"


async def test_verified_results_never_carry_artifacts_or_extra_state() -> None:
    adapter, _logger, _calls = adapter_with(
        lambda _req: json_response(completion(verified_result("Done.")))
    )
    result = await adapter.run(REQUEST, context())
    artifacts: list[Artifact] = result.artifacts
    assert artifacts == []
