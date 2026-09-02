import asyncio
import dataclasses
from collections.abc import Awaitable, Callable
from typing import cast

from agent_voice_worker.adapters.approvals import ApprovalBroker, ApprovalResponse
from agent_voice_worker.adapters.run_action import RunActionOptions, run_action
from agent_voice_worker.adapters.types import (
    ActionContext,
    AdapterRequest,
    AdapterResult,
    ApprovalRequest,
)
from agent_voice_worker.protocol.artifacts import Artifact, LinkArtifact, TextArtifact
from agent_voice_worker.protocol.events import (
    ActionFailed,
    ActionStarted,
    ActionVerified,
    AgentVoiceEvent,
    ApprovalRequested,
    ApprovalResolved,
    Verification,
)
from agent_voice_worker.protocol.limits import LIMITS
from agent_voice_worker.protocol.parse import Ok, parse_event

BASE_REQUEST = {
    "conversation_id": "conv_test",
    "text": "Check the nightly build",
    "session_key": "session-test",
}


def make_ids() -> Callable[[], str]:
    counter = 0

    def _next() -> str:
        nonlocal counter
        counter += 1
        return f"id_{counter:03d}"

    return _next


class Scripted:
    name = "scripted"

    def __init__(
        self, run: Callable[[AdapterRequest, ActionContext], Awaitable[AdapterResult]]
    ) -> None:
        self._run = run

    async def run(self, request: AdapterRequest, context: ActionContext) -> AdapterResult:
        return await self._run(request, context)


def verified(summary: str) -> AdapterResult:
    return AdapterResult(
        status="verified",
        summary=summary,
        verification=Verification(state="verified", method="scripted"),
        artifacts=[],
    )


def harness(adapter: Scripted, **overrides: object) -> RunActionOptions:
    defaults: dict[str, object] = {
        "adapter": adapter,
        "conversation_id": BASE_REQUEST["conversation_id"],
        "text": BASE_REQUEST["text"],
        "session_key": BASE_REQUEST["session_key"],
        "title": "Check the nightly build",
        "timeout_seconds": 5.0,
        "emit": lambda event: None,
        "approvals": ApprovalBroker(),
        "new_id": make_ids(),
    }
    defaults.update(overrides)
    return RunActionOptions(**defaults)  # type: ignore[arg-type]


async def test_emits_started_progress_artifact_and_verified_events_that_all_validate() -> None:
    async def run(_request: AdapterRequest, ctx: ActionContext) -> AdapterResult:
        ctx.progress("Looking up the run", 30)
        ctx.artifact(
            LinkArtifact(id="art_1", kind="link", title="Run", url="https://ci.example.com/1")
        )
        return verified("The nightly build passed.")

    events: list[AgentVoiceEvent] = []
    options = harness(Scripted(run), emit=events.append)
    outcome = await run_action(options)

    assert [type(event).__name__ for event in events] == [
        "ActionStarted",
        "ActionProgress",
        "ArtifactCreated",
        "ActionVerified",
    ]
    for event in events:
        result = parse_event(event.model_dump(mode="json", exclude_none=True))
        assert isinstance(result, Ok)
        assert result.value.conversationId == "conv_test"
    ids = {event.id for event in events}
    assert len(ids) == len(events)
    assert outcome.result.status == "verified"
    assert outcome.action_id == cast(ActionStarted, events[0]).actionId
    terminal = cast(ActionVerified, events[-1])
    assert terminal.summary == "The nightly build passed."
    assert terminal.verification.state == "verified"


async def test_times_out_an_adapter_that_never_returns() -> None:
    observed_abort = False

    async def run(_request: AdapterRequest, _ctx: ActionContext) -> AdapterResult:
        nonlocal observed_abort
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            observed_abort = True
            raise
        return verified("unreachable")

    events: list[AgentVoiceEvent] = []
    options = harness(Scripted(run), emit=events.append, timeout_seconds=0.05)
    outcome = await run_action(options)

    assert observed_abort is True
    assert outcome.result.status == "failed"
    terminal = cast(ActionFailed, events[-1])
    assert terminal.code == "timeout"
    assert terminal.retryable is True


async def test_cancels_through_an_external_signal_and_ignores_late_adapter_activity() -> None:
    late_context: ActionContext | None = None
    cancel_event = asyncio.Event()

    async def run(_request: AdapterRequest, ctx: ActionContext) -> AdapterResult:
        nonlocal late_context
        late_context = ctx
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            raise
        return verified("too late")

    events: list[AgentVoiceEvent] = []
    options = harness(Scripted(run), emit=events.append, cancel_event=cancel_event)
    task = asyncio.ensure_future(run_action(options))
    await asyncio.sleep(0)
    cancel_event.set()
    outcome = await task

    assert outcome.result.status == "cancelled"
    assert [type(event).__name__ for event in events] == ["ActionStarted", "ActionFailed"]
    assert late_context is not None
    late_context.progress("still going", None)
    await asyncio.sleep(0.01)
    assert len(events) == 2
    assert cast(ActionFailed, events[1]).code == "cancelled"


async def test_never_leaks_adapter_exception_text_into_events() -> None:
    async def run(_request: AdapterRequest, _ctx: ActionContext) -> AdapterResult:
        raise RuntimeError("token=abc123 upstream exploded")

    events: list[AgentVoiceEvent] = []
    options = harness(Scripted(run), emit=events.append)
    await run_action(options)

    terminal = events[-1]
    assert type(terminal).__name__ == "ActionFailed"
    dump = str([event.model_dump(mode="json") for event in events])
    assert "abc123" not in dump
    assert "exploded" not in dump


async def test_runs_an_approval_round_trip_bound_to_the_exact_action_and_approval_ids() -> None:
    async def run(_request: AdapterRequest, ctx: ActionContext) -> AdapterResult:
        decision = await ctx.request_approval(ApprovalRequest(prompt="Re-run failed jobs?"))
        if decision == "approved":
            return verified("Re-ran the failed jobs.")
        return dataclasses.replace(
            verified(""), status="failed", code="rejected", summary="Not re-run."
        )

    events: list[AgentVoiceEvent] = []
    broker = ApprovalBroker()
    options = harness(Scripted(run), emit=events.append, approvals=broker)
    task = asyncio.ensure_future(run_action(options))
    await asyncio.sleep(0.01)

    requested = cast(
        ApprovalRequested, next(e for e in events if type(e).__name__ == "ApprovalRequested")
    )

    assert (
        broker.resolve(
            ApprovalResponse(
                action_id=requested.actionId, approval_id="apr_wrong", decision="approved"
            )
        )
        is False
    )
    assert (
        broker.resolve(
            ApprovalResponse(
                action_id="act_wrong", approval_id=requested.approvalId, decision="approved"
            )
        )
        is False
    )
    assert (
        broker.resolve(
            ApprovalResponse(
                action_id=requested.actionId, approval_id=requested.approvalId, decision="approved"
            )
        )
        is True
    )

    outcome = await task
    assert outcome.result.status == "verified"
    resolved = cast(
        ApprovalResolved, next(e for e in events if type(e).__name__ == "ApprovalResolved")
    )
    assert resolved.decision == "approved"
    assert resolved.resolvedBy == "user"
    assert type(events[-1]).__name__ == "ActionVerified"
    assert (
        broker.resolve(
            ApprovalResponse(
                action_id=requested.actionId, approval_id=requested.approvalId, decision="rejected"
            )
        )
        is False
    )


async def test_expires_an_unanswered_approval_and_lets_the_adapter_fail_honestly() -> None:
    async def run(_request: AdapterRequest, ctx: ActionContext) -> AdapterResult:
        decision = await ctx.request_approval(ApprovalRequest(prompt="Proceed?", expires_in_ms=30))
        assert decision == "expired"
        return AdapterResult(
            status="failed",
            code="expired",
            summary="The approval expired, so nothing was changed.",
            verification=Verification(state="unverified", method="scripted"),
            artifacts=[],
        )

    events: list[AgentVoiceEvent] = []
    options = harness(Scripted(run), emit=events.append)
    outcome = await run_action(options)

    assert outcome.result.status == "failed"
    resolved = cast(
        ApprovalResolved, next(e for e in events if type(e).__name__ == "ApprovalResolved")
    )
    assert resolved.decision == "expired"
    assert resolved.resolvedBy == "system"
    terminal = cast(ActionFailed, events[-1])
    assert terminal.code == "expired"


async def test_refuses_to_report_verified_when_the_adapter_did_not_verify_it() -> None:
    async def run(_request: AdapterRequest, _ctx: ActionContext) -> AdapterResult:
        return AdapterResult(
            status="verified",
            summary="Done!",
            verification=Verification(state="unverified", method="wishful"),
            artifacts=[],
        )

    events: list[object] = []
    options = harness(Scripted(run), emit=events.append)
    outcome = await run_action(options)

    assert outcome.result.status == "failed"
    assert [type(event).__name__ for event in events] == ["ActionStarted", "ActionFailed"]


async def test_rejects_oversized_requests_before_calling_the_adapter_and_bounds_output() -> None:
    called = False

    async def run(_request: AdapterRequest, _ctx: ActionContext) -> AdapterResult:
        nonlocal called
        called = True
        return verified("x" * (LIMITS.max_text_chars + 100))

    events: list[AgentVoiceEvent] = []
    options = harness(Scripted(run), emit=events.append, text="y" * (LIMITS.max_text_chars + 1))
    await run_action(options)
    assert called is False
    terminal = cast(ActionFailed, events[-1])
    assert type(terminal).__name__ == "ActionFailed"
    assert terminal.code == "invalid"

    artifacts: list[Artifact] = [
        TextArtifact(id=f"art_{index}", kind="text", title="Note", text="n")
        for index in range(LIMITS.max_artifacts + 5)
    ]

    async def run_bounded(_request: AdapterRequest, _ctx: ActionContext) -> AdapterResult:
        return dataclasses.replace(verified("s" * (LIMITS.max_text_chars + 5)), artifacts=artifacts)

    bounded_events: list[AgentVoiceEvent] = []
    bounded_options = harness(Scripted(run_bounded), emit=bounded_events.append)
    await run_action(bounded_options)
    last = cast(ActionVerified, bounded_events[-1])
    assert type(last).__name__ == "ActionVerified"
    assert len(last.summary) <= LIMITS.max_text_chars
    assert last.artifacts is not None
    assert len(last.artifacts) == LIMITS.max_artifacts
    for event in bounded_events:
        result = parse_event(event.model_dump(mode="json", exclude_none=True))
        assert isinstance(result, Ok)
