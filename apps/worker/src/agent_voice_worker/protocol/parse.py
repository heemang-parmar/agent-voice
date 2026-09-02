"""Decode, validate, and encode messages that cross the data channel.

Mirrors `packages/protocol/src/parse.ts`. Never throws on malformed,
oversized, unknown, or unsupported input; every parse function returns a
typed result so callers can log and move on.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Generic, Literal, TypeVar

from pydantic import BaseModel, ValidationError

from agent_voice_worker.protocol.commands import COMMAND_MODELS, _Command
from agent_voice_worker.protocol.envelope import Envelope
from agent_voice_worker.protocol.events import EVENT_MODELS, _Event
from agent_voice_worker.protocol.limits import LIMITS, PROTOCOL_VERSION

T = TypeVar("T")

MAX_ISSUES = 10
MAX_ISSUE_CHARS = 200
MAX_TYPE_ECHO_CHARS = 64

ParseReason = Literal[
    "invalid_json", "too_large", "unsupported_version", "unknown_event", "invalid_event"
]


@dataclass(frozen=True, slots=True)
class Ok(Generic[T]):
    value: T
    ok: Literal[True] = field(default=True, init=False)


@dataclass(frozen=True, slots=True)
class Err:
    reason: ParseReason
    ok: Literal[False] = field(default=False, init=False)
    bytes: int | None = None
    version: int | None = None
    type: str | None = None
    issues: tuple[str, ...] | None = None


ParseResult = Ok[T] | Err


def _utf8_byte_length(text: str) -> int:
    return len(text.encode("utf-8"))


def _format_issues(error: ValidationError) -> tuple[str, ...]:
    issues: list[str] = []
    for issue in error.errors()[:MAX_ISSUES]:
        path = ".".join(str(part) for part in issue["loc"])
        text = f"{path}: {issue['msg']}" if path else issue["msg"]
        if len(text) > MAX_ISSUE_CHARS:
            text = f"{text[: MAX_ISSUE_CHARS - 1]}…"
        issues.append(text)
    return tuple(issues)


def decode_raw(input_value: object) -> ParseResult[object]:
    """Turns a raw payload (JSON text, UTF-8 bytes, or an already-decoded
    value) into a plain value, enforcing the byte budget first."""
    if isinstance(input_value, bytes | bytearray | memoryview):
        raw = bytes(input_value)
        if len(raw) > LIMITS.max_event_bytes:
            return Err(reason="too_large", bytes=len(raw))
        try:
            input_value = raw.decode("utf-8")
        except UnicodeDecodeError:
            return Err(reason="invalid_json")
    if isinstance(input_value, str):
        byte_length = _utf8_byte_length(input_value)
        if byte_length > LIMITS.max_event_bytes:
            return Err(reason="too_large", bytes=byte_length)
        try:
            return Ok(json.loads(input_value))
        except json.JSONDecodeError:
            return Err(reason="invalid_json")
    return Ok(input_value)


def _check_envelope(value: object) -> ParseResult[dict[str, object]]:
    """Validates the version and the shared envelope fields, in that order."""
    if not isinstance(value, dict):
        return Err(reason="invalid_event", issues=("payload must be a JSON object",))
    version = value.get("v")
    if version != PROTOCOL_VERSION:
        return Err(
            reason="unsupported_version", version=version if isinstance(version, int) else None
        )
    try:
        Envelope.model_validate(value)
    except ValidationError as error:
        return Err(reason="invalid_event", issues=_format_issues(error))
    return Ok(value)


M = TypeVar("M", bound=BaseModel)


def _parse_message(
    input_value: object,
    models: dict[str, type[M]],
) -> ParseResult[M]:
    decoded = decode_raw(input_value)
    if not decoded.ok:
        return decoded
    checked = _check_envelope(decoded.value)
    if not checked.ok:
        return checked

    message_type = str(checked.value.get("type"))
    model = models.get(message_type)
    if model is None:
        return Err(reason="unknown_event", type=message_type[:MAX_TYPE_ECHO_CHARS])
    try:
        return Ok(model.model_validate(checked.value))
    except ValidationError as error:
        return Err(reason="invalid_event", issues=_format_issues(error))


def parse_event(input_value: object) -> ParseResult[_Event]:
    """Parses and validates an event received from the worker side."""
    return _parse_message(input_value, EVENT_MODELS)


def parse_command(input_value: object) -> ParseResult[_Command]:
    """Parses and validates a command received from the UI."""
    return _parse_message(input_value, COMMAND_MODELS)


class ProtocolEncodeError(Exception):
    def __init__(self, failure: Err, message: str) -> None:
        super().__init__(message)
        self.failure = failure


def _encode_validated(value: M, parse: Callable[[object], ParseResult[M]]) -> str:
    checked = parse(value.model_dump(mode="json", exclude_none=True))
    if not checked.ok:
        raise ProtocolEncodeError(checked, f"refusing to encode message: {checked.reason}")
    text = json.dumps(checked.value.model_dump(mode="json", exclude_none=True))
    byte_length = _utf8_byte_length(text)
    if byte_length > LIMITS.max_event_bytes:
        raise ProtocolEncodeError(
            Err(reason="too_large", bytes=byte_length),
            f"refusing to encode message: {byte_length} bytes exceeds {LIMITS.max_event_bytes}",
        )
    return text


def encode_event(event: _Event) -> str:
    """Validates and serialises an event. Raises `ProtocolEncodeError`
    rather than emit junk."""
    return _encode_validated(event, parse_event)


def encode_command(command: _Command) -> str:
    """Validates and serialises a command. Raises `ProtocolEncodeError`
    rather than emit junk."""
    return _encode_validated(command, parse_command)
