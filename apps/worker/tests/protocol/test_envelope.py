import pytest
from pydantic import BaseModel, ValidationError

from agent_voice_worker.protocol.envelope import (
    Envelope,
    IdStr,
    LabelStr,
    MessageStr,
    TextStr,
    TimestampStr,
)


class _IdHolder(BaseModel):
    value: IdStr


class _LabelHolder(BaseModel):
    value: LabelStr


class _TextHolder(BaseModel):
    value: TextStr


class _MessageHolder(BaseModel):
    value: MessageStr


class _TimestampHolder(BaseModel):
    value: TimestampStr


@pytest.mark.parametrize("value", ["a", "act_abc-123", "A1._:-9", "x" * 64])
def test_id_accepts_bounded_printable_ids(value: str) -> None:
    assert _IdHolder(value=value).value == value


@pytest.mark.parametrize("value", ["", "x" * 65, " leading-space", "has space", "!bad-start"])
def test_id_rejects_empty_oversized_or_unsupported_characters(value: str) -> None:
    with pytest.raises(ValidationError):
        _IdHolder(value=value)


def test_label_requires_at_least_one_character() -> None:
    with pytest.raises(ValidationError):
        _LabelHolder(value="")


def test_label_rejects_more_than_200_characters() -> None:
    with pytest.raises(ValidationError):
        _LabelHolder(value="x" * 201)


def test_text_allows_empty_string() -> None:
    assert _TextHolder(value="").value == ""


def test_text_rejects_more_than_4000_characters() -> None:
    with pytest.raises(ValidationError):
        _TextHolder(value="x" * 4001)


def test_message_requires_at_least_one_character() -> None:
    with pytest.raises(ValidationError):
        _MessageHolder(value="")


def test_message_rejects_more_than_1000_characters() -> None:
    with pytest.raises(ValidationError):
        _MessageHolder(value="x" * 1001)


@pytest.mark.parametrize(
    "value",
    ["2026-09-02T12:00:00Z", "2026-09-02T12:00:00.123Z", "2026-09-02T12:00:00+05:30"],
)
def test_timestamp_accepts_iso8601_with_explicit_offset(value: str) -> None:
    assert _TimestampHolder(value=value).value == value


@pytest.mark.parametrize(
    "value",
    ["2026-09-02T12:00:00", "not-a-timestamp", "2026-09-02", ""],
)
def test_timestamp_rejects_missing_offset_or_malformed_values(value: str) -> None:
    with pytest.raises(ValidationError):
        _TimestampHolder(value=value)


def test_envelope_accepts_a_well_formed_shared_envelope() -> None:
    envelope = Envelope(
        v=1,
        id="evt_abc123",
        ts="2026-09-02T12:00:00Z",
        conversationId="conv_1",
        type="conversation.started",
    )
    assert envelope.v == 1
    assert envelope.type == "conversation.started"


def test_envelope_rejects_a_version_other_than_one() -> None:
    with pytest.raises(ValidationError):
        Envelope(
            v=2,  # type: ignore[arg-type]
            id="evt_abc123",
            ts="2026-09-02T12:00:00Z",
            conversationId="conv_1",
            type="conversation.started",
        )


def test_envelope_allows_unknown_extra_fields() -> None:
    # The loose envelope check happens before dispatch to a strict concrete
    # event schema; it must not reject on fields it doesn't know about yet.
    envelope = Envelope.model_validate(
        {
            "v": 1,
            "id": "evt_abc123",
            "ts": "2026-09-02T12:00:00Z",
            "conversationId": "conv_1",
            "type": "conversation.started",
            "agentName": "agent-voice",
            "adapter": "openai-http",
        }
    )
    assert envelope.type == "conversation.started"
