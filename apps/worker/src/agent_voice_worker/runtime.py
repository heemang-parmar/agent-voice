"""Wires one conversation's commands, cancellation and delegated actions
together. Everything here is deterministic and network-free: the LiveKit
room only supplies bytes in and an `emit` callback out.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Literal

from agent_voice_worker.adapters.approvals import ApprovalBroker, ApprovalResponse
from agent_voice_worker.adapters.run_action import (
    GENERIC_SUMMARIES,
    ActionOutcome,
    RunActionOptions,
    default_new_id,
    run_action,
)
from agent_voice_worker.adapters.types import AdapterResult, AgentAdapter
from agent_voice_worker.protocol.commands import ActionCancel, ApprovalRespond, ConversationCancel
from agent_voice_worker.protocol.events import (
    AgentMessageFinal,
    AgentVoiceEvent,
    ConversationCancelled,
    ConversationStarted,
    UserTranscriptFinal,
    UserTranscriptPartial,
    Verification,
)
from agent_voice_worker.protocol.parse import parse_command

CancelReason = Literal["user", "agent", "error", "timeout"]


def _now_iso() -> str:
    return datetime.now(tz=UTC).isoformat()


class NullAdapter:
    """Stands in when no delegated agent is configured. Always honest: it
    never claims success."""

    name = "none"

    async def run(self, request: object, context: object) -> AdapterResult:
        return AdapterResult(
            status="unavailable",
            summary=GENERIC_SUMMARIES["unavailable"],
            verification=Verification(state="unverified", method=self.name),
            artifacts=[],
            code="unavailable",
        )


class ConversationRuntime:
    def __init__(
        self,
        *,
        conversation_id: str,
        session_key: str,
        adapter: AgentAdapter,
        timeout_seconds: float,
        emit: Callable[[AgentVoiceEvent], None],
        new_id: Callable[[], str] = default_new_id,
    ) -> None:
        self.conversation_id = conversation_id
        self.session_key = session_key
        self.adapter = adapter
        self.timeout_seconds = timeout_seconds
        self.approvals = ApprovalBroker()
        self._emit = emit
        self._new_id = new_id
        self._actions: dict[str, asyncio.Event] = {}
        self._conversation_cancelled = asyncio.Event()

    @property
    def cancelled(self) -> bool:
        return self._conversation_cancelled.is_set()

    def _envelope(self) -> dict[str, object]:
        return {
            "v": 1,
            "id": f"evt_{self._new_id()}",
            "ts": _now_iso(),
            "conversationId": self.conversation_id,
        }

    def emit_conversation_started(self, *, agent_name: str) -> None:
        self._emit(
            ConversationStarted(
                **self._envelope(),
                type="conversation.started",
                agentName=agent_name,
                adapter=self.adapter.name,
            )
        )

    def emit_user_transcript(self, *, segment_id: str, text: str, is_final: bool) -> None:
        if is_final:
            self._emit(
                UserTranscriptFinal(
                    **self._envelope(),
                    type="user.transcript.final",
                    segmentId=segment_id,
                    text=text,
                )
            )
            return
        self._emit(
            UserTranscriptPartial(
                **self._envelope(),
                type="user.transcript.partial",
                segmentId=segment_id,
                text=text,
            )
        )

    def emit_agent_message(self, *, message_id: str, text: str) -> None:
        self._emit(
            AgentMessageFinal(
                **self._envelope(),
                type="agent.message.final",
                messageId=message_id,
                text=text,
            )
        )

    def cancel_conversation(self, *, reason: CancelReason) -> None:
        if self._conversation_cancelled.is_set():
            return
        self._conversation_cancelled.set()
        for event in self._actions.values():
            event.set()
        self._emit(
            ConversationCancelled(**self._envelope(), type="conversation.cancelled", reason=reason)
        )

    def handle_command(self, raw: object) -> None:
        """Never raises: malformed, unknown, or stale commands are silently
        dropped, exactly like the protocol layer promises."""
        result = parse_command(raw)
        if not result.ok:
            return
        command = result.value
        if isinstance(command, ApprovalRespond):
            self.approvals.resolve(
                ApprovalResponse(
                    action_id=command.actionId,
                    approval_id=command.approvalId,
                    decision=command.decision,
                )
            )
        elif isinstance(command, ActionCancel):
            event = self._actions.get(command.actionId)
            if event is not None:
                event.set()
        elif isinstance(command, ConversationCancel):
            self.cancel_conversation(reason="user")

    async def run_delegated_action(self, *, text: str, title: str) -> ActionOutcome:
        action_id = f"act_{self._new_id()}"
        if self._conversation_cancelled.is_set():
            return ActionOutcome(
                action_id=action_id,
                result=AdapterResult(
                    status="cancelled",
                    summary=GENERIC_SUMMARIES["cancelled"],
                    verification=Verification(state="unverified", method=self.adapter.name),
                    artifacts=[],
                    code="cancelled",
                ),
            )

        cancel_event = asyncio.Event()
        self._actions[action_id] = cancel_event
        try:
            options = RunActionOptions(
                adapter=self.adapter,
                conversation_id=self.conversation_id,
                text=text,
                session_key=self.session_key,
                title=title,
                timeout_seconds=self.timeout_seconds,
                emit=self._emit,
                approvals=self.approvals,
                action_id=action_id,
                cancel_event=cancel_event,
                new_id=self._new_id,
            )
            return await run_action(options)
        finally:
            self._actions.pop(action_id, None)
