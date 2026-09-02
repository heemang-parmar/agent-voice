"""Events the worker emits on the `agent-voice.events.v1` data-channel topic.

Every event is the shared envelope plus a `type` literal plus its own
fields, and it is strict: unknown keys are rejected rather than ignored so
nothing can be smuggled past validation. Mirrors
`packages/protocol/src/events.ts`.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from agent_voice_worker.protocol.artifacts import Artifact
from agent_voice_worker.protocol.envelope import (
    Envelope,
    IdStr,
    LabelStr,
    MessageStr,
    TextStr,
    TimestampStr,
)

FAILURE_CODES: tuple[str, ...] = (
    "failed",
    "unavailable",
    "timeout",
    "cancelled",
    "rejected",
    "expired",
    "invalid",
)
FailureCode = Literal[
    "failed", "unavailable", "timeout", "cancelled", "rejected", "expired", "invalid"
]

ApprovalDecision = Literal["approved", "rejected", "expired"]


class Verification(BaseModel):
    """An adapter-obtained proof, as opposed to something the voice model
    could have made up."""

    model_config = ConfigDict(extra="forbid")

    state: Literal["verified", "unverified"]
    method: LabelStr
    detail: Annotated[str, StringConstraints(max_length=1000)] | None = None


class VerifiedVerification(BaseModel):
    """Same as `Verification` but pinned to `state: "verified"` — a
    `action.verified` event must carry real evidence, not just a claim."""

    model_config = ConfigDict(extra="forbid")

    state: Literal["verified"]
    method: LabelStr
    detail: Annotated[str, StringConstraints(max_length=1000)] | None = None


class _Event(Envelope):
    model_config = ConfigDict(extra="forbid")


class ConversationStarted(_Event):
    type: Literal["conversation.started"]
    agentName: LabelStr
    adapter: LabelStr


class UserTranscriptPartial(_Event):
    type: Literal["user.transcript.partial"]
    segmentId: IdStr
    text: TextStr


class UserTranscriptFinal(_Event):
    type: Literal["user.transcript.final"]
    segmentId: IdStr
    text: TextStr


class AgentMessagePartial(_Event):
    type: Literal["agent.message.partial"]
    messageId: IdStr
    text: TextStr


class AgentMessageFinal(_Event):
    type: Literal["agent.message.final"]
    messageId: IdStr
    text: TextStr


class ActionStarted(_Event):
    type: Literal["action.started"]
    actionId: IdStr
    title: LabelStr
    adapter: LabelStr


class ActionProgress(_Event):
    type: Literal["action.progress"]
    actionId: IdStr
    message: MessageStr
    percent: Annotated[float, Field(ge=0, le=100)] | None = None


class ApprovalRequested(_Event):
    """Approvals are always bound to one action and always expire."""

    type: Literal["approval.requested"]
    actionId: IdStr
    approvalId: IdStr
    prompt: MessageStr
    expiresAt: TimestampStr


class ApprovalResolved(_Event):
    type: Literal["approval.resolved"]
    actionId: IdStr
    approvalId: IdStr
    decision: ApprovalDecision
    resolvedBy: Literal["user", "system"] | None = None


class ArtifactCreated(_Event):
    type: Literal["artifact.created"]
    actionId: IdStr
    artifact: Artifact


class ActionVerified(_Event):
    type: Literal["action.verified"]
    actionId: IdStr
    summary: TextStr
    verification: VerifiedVerification
    artifacts: Annotated[list[Artifact], Field(max_length=20)] | None = None


class ActionFailed(_Event):
    type: Literal["action.failed"]
    actionId: IdStr
    code: FailureCode
    summary: TextStr
    retryable: bool


class ConversationCancelled(_Event):
    type: Literal["conversation.cancelled"]
    reason: Literal["user", "agent", "error", "timeout"]
    detail: Annotated[str, StringConstraints(max_length=1000)] | None = None


AgentVoiceEvent = Annotated[
    ConversationStarted
    | UserTranscriptPartial
    | UserTranscriptFinal
    | AgentMessagePartial
    | AgentMessageFinal
    | ActionStarted
    | ActionProgress
    | ApprovalRequested
    | ApprovalResolved
    | ArtifactCreated
    | ActionVerified
    | ActionFailed
    | ConversationCancelled,
    Field(discriminator="type"),
]

EVENT_MODELS: dict[str, type[_Event]] = {
    "conversation.started": ConversationStarted,
    "user.transcript.partial": UserTranscriptPartial,
    "user.transcript.final": UserTranscriptFinal,
    "agent.message.partial": AgentMessagePartial,
    "agent.message.final": AgentMessageFinal,
    "action.started": ActionStarted,
    "action.progress": ActionProgress,
    "approval.requested": ApprovalRequested,
    "approval.resolved": ApprovalResolved,
    "artifact.created": ArtifactCreated,
    "action.verified": ActionVerified,
    "action.failed": ActionFailed,
    "conversation.cancelled": ConversationCancelled,
}

EVENT_TYPES: tuple[str, ...] = tuple(EVENT_MODELS.keys())


def is_event_type(value: str) -> bool:
    return value in EVENT_MODELS


def event_model_for(event_type: str) -> type[_Event]:
    return EVENT_MODELS[event_type]
