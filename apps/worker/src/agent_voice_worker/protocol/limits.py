"""Hard bounds for everything that crosses the wire.

These are part of the contract: producers must respect them and consumers
must reject anything larger instead of trying to be lenient. Mirrors
`packages/protocol/src/limits.ts`.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

PROTOCOL_VERSION: Literal[1] = 1


@dataclass(frozen=True, slots=True)
class _Limits:
    """Maximum encoded size of a single event or command, in UTF-8 bytes."""

    max_event_bytes: int = 12 * 1024
    """Identifiers: event ids, conversation ids, action ids, segment ids, ..."""
    max_id_chars: int = 64
    """Short human labels: agent names, adapter names, titles, methods."""
    max_label_chars: int = 200
    """Transcript text, agent messages, speakable summaries."""
    max_text_chars: int = 4000
    """Progress messages and approval prompts."""
    max_message_chars: int = 1000
    """Artifact URLs."""
    max_url_chars: int = 2048
    """Artifacts attached to a single event."""
    max_artifacts: int = 20
    """Inline artifact text."""
    max_artifact_text_chars: int = 4000


LIMITS = _Limits()


@dataclass(frozen=True, slots=True)
class _Topics:
    """Data-channel topics used by the LiveKit transport binding."""

    events: str = "agent-voice.events.v1"
    commands: str = "agent-voice.commands.v1"


TOPICS = _Topics()

CHAT_TOPIC = "lk.chat"
"""Text-stream topic the worker's text input listens on."""
