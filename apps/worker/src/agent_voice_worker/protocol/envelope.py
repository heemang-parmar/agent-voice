"""Shared envelope fields and scalar constraints.

Mirrors `packages/protocol/src/envelope.ts`.
"""

from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, StringConstraints

from agent_voice_worker.protocol.limits import LIMITS, PROTOCOL_VERSION

_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")
_TIMESTAMP_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$")

IdStr = Annotated[
    str,
    StringConstraints(min_length=1, max_length=LIMITS.max_id_chars, pattern=_ID_PATTERN),
]
"""Identifiers are opaque, printable, and bounded."""

LabelStr = Annotated[str, StringConstraints(min_length=1, max_length=LIMITS.max_label_chars)]
TextStr = Annotated[str, StringConstraints(max_length=LIMITS.max_text_chars)]
MessageStr = Annotated[str, StringConstraints(min_length=1, max_length=LIMITS.max_message_chars)]


def _check_timestamp(value: str) -> str:
    if not _TIMESTAMP_PATTERN.match(value):
        raise ValueError("timestamp must be ISO-8601 with an explicit zone")
    return value


TimestampStr = Annotated[str, AfterValidator(_check_timestamp)]
"""Timestamps are ISO-8601 with an explicit zone."""


class Envelope(BaseModel):
    """Fields shared by every event and command.

    `type` is refined by each concrete schema; keeping it a plain bounded
    string here lets the parser detect "well-formed envelope, unknown type"
    separately from "garbage". Unlike concrete event/command models, this is
    deliberately not strict: it only validates the shared fields before
    dispatch to a strict concrete schema.
    """

    model_config = ConfigDict(extra="ignore")

    v: Literal[1] = PROTOCOL_VERSION
    id: IdStr
    ts: TimestampStr
    conversationId: IdStr
    type: Annotated[str, StringConstraints(min_length=1, max_length=LIMITS.max_label_chars)]
