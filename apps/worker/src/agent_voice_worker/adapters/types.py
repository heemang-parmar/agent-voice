"""What the voice layer hands to an adapter, and what it gets back.

Mirrors `packages/adapter-sdk/src/types.ts`.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Literal, Protocol

from agent_voice_worker.protocol.artifacts import Artifact
from agent_voice_worker.protocol.events import ApprovalDecision, FailureCode, Verification


@dataclass(frozen=True, slots=True)
class AdapterRequest:
    """Text is already bounded by the protocol layer before this is built."""

    conversation_id: str
    action_id: str
    text: str
    """Stable, configurable key that lets the agent keep memory across turns."""
    session_key: str
    locale: str | None = None


@dataclass(frozen=True, slots=True)
class ApprovalRequest:
    prompt: str
    """How long the user has to answer. Always capped by the action deadline."""
    expires_in_ms: float | None = None


@dataclass(slots=True)
class ActionContext:
    """Everything an adapter can do while it runs.

    Progress and artifacts are fire-and-forget; approvals block until the
    user answers or the request expires. All of it is ignored once the
    action has reached a terminal state.
    """

    cancelled: Callable[[], bool]
    """Epoch milliseconds after which the action is failed with `timeout`."""
    deadline: float
    progress: Callable[[str, float | None], None]
    artifact: Callable[[Artifact], None]
    request_approval: Callable[[ApprovalRequest], Awaitable[ApprovalDecision]]


AdapterStatus = Literal["verified", "failed", "unavailable", "cancelled"]


@dataclass(frozen=True, slots=True)
class AdapterResult:
    status: AdapterStatus
    """Short, speakable, user-facing summary. Never raw error text."""
    summary: str
    """Must be `verified` for a `verified` status; the runner enforces it."""
    verification: Verification
    artifacts: list[Artifact] = field(default_factory=list)
    """Optional finer-grained failure reason; defaults are derived from `status`."""
    code: FailureCode | None = None
    retryable: bool | None = None


class AgentAdapter(Protocol):
    @property
    def name(self) -> str: ...

    async def run(self, request: AdapterRequest, context: ActionContext) -> AdapterResult: ...
