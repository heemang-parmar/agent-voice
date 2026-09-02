"""Runs one delegated action end to end and turns everything the adapter
does into protocol events.

Guarantees: exactly one `action.started`, exactly one terminal event
(`action.verified` or `action.failed`), nothing after the terminal event, a
hard deadline, and no adapter exception text on the wire. Mirrors
`packages/adapter-sdk/src/run-action.ts`.
"""

from __future__ import annotations

import asyncio
import contextlib
import dataclasses
import secrets
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime

from agent_voice_worker.adapters.approvals import ApprovalBroker, PendingApproval
from agent_voice_worker.adapters.types import (
    ActionContext,
    AdapterRequest,
    AdapterResult,
    AdapterStatus,
    AgentAdapter,
    ApprovalRequest,
)
from agent_voice_worker.protocol.artifacts import Artifact
from agent_voice_worker.protocol.events import (
    ActionFailed,
    ActionProgress,
    ActionStarted,
    ActionVerified,
    AgentVoiceEvent,
    ApprovalDecision,
    ApprovalRequested,
    ApprovalResolved,
    ArtifactCreated,
    FailureCode,
    Verification,
    VerifiedVerification,
)
from agent_voice_worker.protocol.limits import LIMITS

GENERIC_SUMMARIES: dict[FailureCode, str] = {
    "failed": "The agent could not complete that, so nothing was changed.",
    "unavailable": "The agent is not reachable right now, so nothing was changed.",
    "timeout": "The agent took too long to respond, so I stopped waiting.",
    "cancelled": "Cancelled. Nothing further was changed.",
    "rejected": "You declined, so nothing was changed.",
    "expired": "The approval expired, so nothing was changed.",
    "invalid": "I could not pass that request to the agent.",
}


def default_new_id() -> str:
    return secrets.token_urlsafe(9)


def _now_ms() -> float:
    return time.time() * 1000


@dataclass(slots=True)
class RunActionOptions:
    adapter: AgentAdapter
    conversation_id: str
    text: str
    session_key: str
    """Short label for the action timeline."""
    title: str
    timeout_seconds: float
    """Receives every validated event, in order. Must not throw."""
    emit: Callable[[AgentVoiceEvent], None]
    approvals: ApprovalBroker
    action_id: str | None = None
    locale: str | None = None
    """External cancellation (user pressed cancel, conversation ended)."""
    cancel_event: asyncio.Event | None = None
    """Default approval window when the adapter does not specify one."""
    approval_timeout_seconds: float | None = None
    new_id: Callable[[], str] = default_new_id
    now: Callable[[], float] = _now_ms


@dataclass(frozen=True, slots=True)
class ActionOutcome:
    action_id: str
    result: AdapterResult


def _clamp_text(text: str, max_len: int) -> str:
    return text if len(text) <= max_len else f"{text[: max_len - 1]}…"


def _speakable(summary: str, fallback: str) -> str:
    trimmed = summary.strip()
    return _clamp_text(trimmed if trimmed else fallback, LIMITS.max_text_chars)


def _iso(epoch_ms: float) -> str:
    return datetime.fromtimestamp(epoch_ms / 1000, tz=UTC).isoformat()


def _failure_code_for(result: AdapterResult) -> FailureCode:
    if result.code:
        return result.code
    if result.status == "unavailable":
        return "unavailable"
    if result.status == "cancelled":
        return "cancelled"
    return "failed"


async def run_action(options: RunActionOptions) -> ActionOutcome:
    new_id = options.new_id
    now = options.now
    action_id = options.action_id or f"act_{new_id()}"
    conversation_id = options.conversation_id
    deadline = now() + options.timeout_seconds * 1000
    approval_window_ms = (
        options.approval_timeout_seconds * 1000
        if options.approval_timeout_seconds is not None
        else min(120_000.0, options.timeout_seconds * 1000)
    )

    terminal = False
    artifact_count = 0

    def envelope_fields() -> dict[str, object]:
        return {
            "v": 1,
            "id": f"evt_{new_id()}",
            "ts": _iso(now()),
            "conversationId": conversation_id,
        }

    def emit(event: AgentVoiceEvent) -> None:
        if terminal:
            return
        options.emit(event)

    abort_event = asyncio.Event()
    abort_code: FailureCode | None = None

    def abort(code: FailureCode) -> None:
        nonlocal abort_code
        if not abort_event.is_set():
            abort_code = code
            abort_event.set()

    async def watch_timeout() -> None:
        await asyncio.sleep(options.timeout_seconds)
        abort("timeout")

    async def watch_external_cancel(cancel_event: asyncio.Event) -> None:
        await cancel_event.wait()
        abort("cancelled")

    background: list[asyncio.Task[None]] = [asyncio.ensure_future(watch_timeout())]
    if options.cancel_event is not None:
        if options.cancel_event.is_set():
            abort("cancelled")
        else:
            background.append(asyncio.ensure_future(watch_external_cancel(options.cancel_event)))

    def finish(result: AdapterResult) -> ActionOutcome:
        nonlocal terminal
        summary_fallback = GENERIC_SUMMARIES[_failure_code_for(result)]
        if result.status == "verified" and result.verification.state == "verified":
            artifacts = result.artifacts[: LIMITS.max_artifacts]
            emit(
                ActionVerified(
                    **envelope_fields(),
                    type="action.verified",
                    actionId=action_id,
                    summary=_speakable(result.summary, "Done."),
                    verification=VerifiedVerification(
                        state="verified",
                        method=_clamp_text(result.verification.method, LIMITS.max_label_chars),
                        detail=(
                            _clamp_text(result.verification.detail, 1000)
                            if result.verification.detail is not None
                            else None
                        ),
                    ),
                    artifacts=artifacts if artifacts else None,
                )
            )
            terminal = True
            return ActionOutcome(
                action_id=action_id, result=dataclasses.replace(result, artifacts=artifacts)
            )

        # A "verified" status without verified evidence is a failure to verify.
        normalized = result
        if result.status == "verified":
            normalized = AdapterResult(
                status="failed",
                summary="The agent responded, but the result could not be verified.",
                verification=Verification(
                    state="unverified",
                    method=result.verification.method,
                    detail=result.verification.detail,
                ),
                artifacts=result.artifacts,
                code="failed",
                retryable=result.retryable,
            )
        code = _failure_code_for(normalized)
        emit(
            ActionFailed(
                **envelope_fields(),
                type="action.failed",
                actionId=action_id,
                code=code,
                summary=_speakable(normalized.summary, summary_fallback),
                retryable=(
                    normalized.retryable
                    if normalized.retryable is not None
                    else code in ("unavailable", "timeout")
                ),
            )
        )
        terminal = True
        return ActionOutcome(action_id=action_id, result=normalized)

    def fail_with(code: FailureCode) -> ActionOutcome:
        status: AdapterStatus
        if code == "cancelled":
            status = "cancelled"
        elif code == "unavailable":
            status = "unavailable"
        else:
            status = "failed"
        return finish(
            AdapterResult(
                status=status,
                summary=GENERIC_SUMMARIES[code],
                verification=Verification(state="unverified", method=options.adapter.name),
                artifacts=[],
                code=code,
            )
        )

    emit(
        ActionStarted(
            **envelope_fields(),
            type="action.started",
            actionId=action_id,
            title=_clamp_text(options.title.strip() or "Delegated action", LIMITS.max_label_chars),
            adapter=_clamp_text(options.adapter.name, LIMITS.max_label_chars),
        )
    )

    async def cleanup() -> None:
        for task in background:
            task.cancel()
        await asyncio.gather(*background, return_exceptions=True)
        options.approvals.expire_action(action_id)

    text = options.text
    if not isinstance(text, str) or len(text.strip()) == 0 or len(text) > LIMITS.max_text_chars:
        outcome = fail_with("invalid")
        await cleanup()
        return outcome
    if abort_event.is_set():
        outcome = fail_with(abort_code or "cancelled")
        await cleanup()
        return outcome

    def progress(message: str, percent: float | None = None) -> None:
        if terminal:
            return
        trimmed = message.strip()
        if not trimmed:
            return
        emit(
            ActionProgress(
                **envelope_fields(),
                type="action.progress",
                actionId=action_id,
                message=_clamp_text(trimmed, LIMITS.max_message_chars),
                percent=min(100.0, max(0.0, percent)) if percent is not None else None,
            )
        )

    def artifact_cb(artifact: Artifact) -> None:
        nonlocal artifact_count
        if terminal or artifact_count >= LIMITS.max_artifacts:
            return
        artifact_count += 1
        emit(
            ArtifactCreated(
                **envelope_fields(), type="artifact.created", actionId=action_id, artifact=artifact
            )
        )

    async def request_approval(request: ApprovalRequest) -> ApprovalDecision:
        if terminal or abort_event.is_set():
            return "expired"
        approval_id = f"apr_{new_id()}"
        window = request.expires_in_ms if request.expires_in_ms is not None else approval_window_ms
        expires_at = min(now() + max(0.0, window), deadline)
        emit(
            ApprovalRequested(
                **envelope_fields(),
                type="approval.requested",
                actionId=action_id,
                approvalId=approval_id,
                prompt=_clamp_text(
                    request.prompt.strip() or "Approve this action?", LIMITS.max_message_chars
                ),
                expiresAt=_iso(expires_at),
            )
        )
        decision = await options.approvals.request(
            PendingApproval(action_id=action_id, approval_id=approval_id, expires_at=expires_at),
            abort_event,
        )
        emit(
            ApprovalResolved(
                **envelope_fields(),
                type="approval.resolved",
                actionId=action_id,
                approvalId=approval_id,
                decision=decision,
                resolvedBy="system" if decision == "expired" else "user",
            )
        )
        return decision

    context = ActionContext(
        cancelled=abort_event.is_set,
        deadline=deadline,
        progress=progress,
        artifact=artifact_cb,
        request_approval=request_approval,
    )

    request = AdapterRequest(
        conversation_id=conversation_id,
        action_id=action_id,
        text=text,
        session_key=options.session_key,
        locale=options.locale,
    )

    adapter_task: asyncio.Task[AdapterResult] = asyncio.ensure_future(
        options.adapter.run(request, context)
    )
    abort_wait_task: asyncio.Task[bool] = asyncio.ensure_future(abort_event.wait())

    done, _pending = await asyncio.wait(
        {adapter_task, abort_wait_task}, return_when=asyncio.FIRST_COMPLETED
    )

    if adapter_task in done:
        abort_wait_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await abort_wait_task
        try:
            result = adapter_task.result()
            outcome = finish(result)
        except Exception:
            outcome = fail_with("failed")
    else:
        adapter_task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await adapter_task
        outcome = fail_with(abort_code or "cancelled")

    await cleanup()
    return outcome
