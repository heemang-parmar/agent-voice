import json
from typing import Any, cast

import pytest

from agent_voice_worker.protocol.commands import ActionCancel
from agent_voice_worker.protocol.events import ActionStarted
from agent_voice_worker.protocol.limits import LIMITS
from agent_voice_worker.protocol.parse import (
    Err,
    Ok,
    ProtocolEncodeError,
    decode_raw,
    encode_command,
    encode_event,
    parse_command,
    parse_event,
)

VALID_EVENT = {
    "v": 1,
    "id": "evt_1",
    "ts": "2026-09-02T12:00:00Z",
    "conversationId": "conv_1",
    "type": "action.started",
    "actionId": "act_1",
    "title": "Send email",
    "adapter": "openai-http",
}

VALID_COMMAND = {
    "v": 1,
    "id": "cmd_1",
    "ts": "2026-09-02T12:00:00Z",
    "conversationId": "conv_1",
    "type": "action.cancel",
    "actionId": "act_1",
}


def test_decode_raw_accepts_a_dict_directly() -> None:
    result = decode_raw(VALID_EVENT)
    assert isinstance(result, Ok)
    assert result.value == VALID_EVENT


def test_decode_raw_parses_json_text() -> None:
    result = decode_raw(json.dumps(VALID_EVENT))
    assert isinstance(result, Ok)
    assert isinstance(result.value, dict)
    assert result.value["id"] == "evt_1"


def test_decode_raw_parses_utf8_bytes() -> None:
    result = decode_raw(json.dumps(VALID_EVENT).encode("utf-8"))
    assert isinstance(result, Ok)


def test_decode_raw_rejects_invalid_json() -> None:
    result = decode_raw("{not json")
    assert isinstance(result, Err)
    assert result.reason == "invalid_json"


def test_decode_raw_rejects_oversized_payloads() -> None:
    huge = json.dumps({**VALID_EVENT, "title": "x" * LIMITS.max_event_bytes})
    result = decode_raw(huge)
    assert isinstance(result, Err)
    assert result.reason == "too_large"


def test_parse_event_accepts_a_well_formed_event() -> None:
    result = parse_event(VALID_EVENT)
    assert isinstance(result, Ok)
    assert isinstance(result.value, ActionStarted)


def test_parse_event_rejects_unsupported_protocol_version() -> None:
    result = parse_event({**VALID_EVENT, "v": 2})
    assert isinstance(result, Err)
    assert result.reason == "unsupported_version"
    assert result.version == 2


def test_parse_event_rejects_unknown_event_types() -> None:
    result = parse_event({**VALID_EVENT, "type": "nonexistent.event"})
    assert isinstance(result, Err)
    assert result.reason == "unknown_event"
    assert result.type == "nonexistent.event"


def test_parse_event_rejects_a_known_type_with_bad_fields() -> None:
    result = parse_event({**VALID_EVENT, "title": ""})
    assert isinstance(result, Err)
    assert result.reason == "invalid_event"
    assert result.issues is not None
    assert len(result.issues) > 0


def test_parse_event_rejects_garbage_payloads() -> None:
    result = parse_event(["not", "an", "object"])
    assert isinstance(result, Err)
    assert result.reason == "invalid_event"


def test_parse_command_accepts_a_well_formed_command() -> None:
    result = parse_command(VALID_COMMAND)
    assert isinstance(result, Ok)
    assert isinstance(result.value, ActionCancel)


def test_parse_command_rejects_unknown_command_types() -> None:
    result = parse_command({**VALID_COMMAND, "type": "nonexistent.command"})
    assert isinstance(result, Err)
    assert result.reason == "unknown_event"


def test_encode_event_round_trips_through_parse_event() -> None:
    event = ActionStarted.model_validate(VALID_EVENT)
    text = encode_event(event)
    result = parse_event(text)
    assert isinstance(result, Ok)
    assert result.value == event


def test_encode_event_omits_unset_optional_fields() -> None:
    event = ActionStarted.model_validate(VALID_EVENT)
    text = encode_event(event)
    assert "artifacts" not in json.loads(text)


def test_encode_event_refuses_to_emit_an_invalid_event() -> None:
    event = ActionStarted.model_construct(**cast(Any, {**VALID_EVENT, "title": ""}))
    with pytest.raises(ProtocolEncodeError):
        encode_event(event)


def test_encode_command_round_trips_through_parse_command() -> None:
    command = ActionCancel.model_validate(VALID_COMMAND)
    text = encode_command(command)
    result = parse_command(text)
    assert isinstance(result, Ok)
    assert result.value == command
