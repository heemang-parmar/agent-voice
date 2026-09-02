"""Command dispatch, cancellation and delegation wiring for one conversation.

Fully deterministic: no LiveKit room, no network. `emit` is a plain list
append and adapters are scripted fakes, exactly like `test_run_action.py`.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import cast

from agent_voice_worker.adapters.types import (
    ActionContext,
    AdapterRequest,
    AdapterResult,
    ApprovalRequest,
)
from agent_voice_worker.protocol.events import (
    ActionStarted,
    AgentVoiceEvent,
    ApprovalRequested,
    ConversationCancelled,
    ConversationStarted,
    Verification,
)
from agent_voice_worker.protocol.parse import Ok, parse_event
from agent_voice_worker.runtime import ConversationRuntime


class Scripted:
    def __init__(
        self,
        run: Callable[[AdapterRequest, ActionContext], Awaitable[AdapterResult]],
        name: str = "scripted",
    ) -> None:
        self.name = name
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


async def _always_verified(_request: AdapterRequest, _ctx: ActionContext) -> AdapterResult:
    return verified("x")


def make_ids() -> Callable[[], str]:
    counter = 0

    def _next() -> str:
        nonlocal counter
        counter += 1
        return f"id_{counter:03d}"

    return _next


def make_runtime(
    adapter: Scripted, events: list[AgentVoiceEvent], **overrides: object
) -> ConversationRuntime:
    defaults: dict[str, object] = {
        "conversation_id": "conv_test",
        "session_key": "session-test",
        "adapter": adapter,
        "timeout_seconds": 5.0,
        "emit": events.append,
        "new_id": make_ids(),
    }
    defaults.update(overrides)
    return ConversationRuntime(**defaults)  # type: ignore[arg-type]


async def test_run_delegated_action_returns_a_verified_outcome_and_valid_events() -> None:
    async def run(_request: AdapterRequest, _ctx: ActionContext) -> AdapterResult:
        return verified("Done.")

    events: list[AgentVoiceEvent] = []
    runtime = make_runtime(Scripted(run), events)
    outcome = await runtime.run_delegated_action(text="do the thing", title="Do the thing")

    assert outcome.result.status == "verified"
    assert [type(event).__name__ for event in events] == ["ActionStarted", "ActionVerified"]
    for event in events:
        result = parse_event(event.model_dump(mode="json", exclude_none=True))
        assert isinstance(result, Ok)


async def test_action_cancel_command_cancels_only_the_named_action() -> None:
    releases: dict[str, asyncio.Event] = {}

    async def run(request: AdapterRequest, _ctx: ActionContext) -> AdapterResult:
        release = asyncio.Event()
        releases[request.text] = release
        await release.wait()
        return verified(f"{request.text} done")

    events: list[AgentVoiceEvent] = []
    runtime = make_runtime(Scripted(run), events)

    first_task = asyncio.ensure_future(runtime.run_delegated_action(text="first", title="First"))
    await asyncio.sleep(0)
    while "first" not in releases:
        await asyncio.sleep(0)

    second_task = asyncio.ensure_future(runtime.run_delegated_action(text="second", title="Second"))
    await asyncio.sleep(0)
    while "second" not in releases:
        await asyncio.sleep(0)

    started = [cast(ActionStarted, e) for e in events if type(e).__name__ == "ActionStarted"]
    assert len(started) == 2
    first_action_id = started[0].actionId

    runtime.handle_command(
        {
            "v": 1,
            "id": "cmd_1",
            "ts": "2024-01-01T00:00:00Z",
            "conversationId": "conv_test",
            "type": "action.cancel",
            "actionId": first_action_id,
        }
    )
    releases["second"].set()

    first_outcome = await first_task
    second_outcome = await second_task
    assert first_outcome.result.status == "cancelled"
    assert second_outcome.result.status == "verified"


async def test_conversation_cancel_command_cancels_in_flight_actions_and_emits_cancelled() -> None:
    release = asyncio.Event()

    async def run(_request: AdapterRequest, _ctx: ActionContext) -> AdapterResult:
        await release.wait()
        return verified("too late")

    events: list[AgentVoiceEvent] = []
    runtime = make_runtime(Scripted(run), events, timeout_seconds=5.0)

    task = asyncio.ensure_future(runtime.run_delegated_action(text="do it", title="Do it"))
    await asyncio.sleep(0)

    runtime.handle_command(
        {
            "v": 1,
            "id": "cmd_1",
            "ts": "2024-01-01T00:00:00Z",
            "conversationId": "conv_test",
            "type": "conversation.cancel",
        }
    )
    outcome = await task

    assert outcome.result.status == "cancelled"
    assert "ConversationCancelled" in [type(e).__name__ for e in events]
    cancelled_event = cast(
        ConversationCancelled,
        next(e for e in events if type(e).__name__ == "ConversationCancelled"),
    )
    result = parse_event(cancelled_event.model_dump(mode="json", exclude_none=True))
    assert isinstance(result, Ok)


async def test_new_delegation_after_conversation_cancelled_is_refused_without_calling_the_adapter() -> (
    None
):
    called = False

    async def run(_request: AdapterRequest, _ctx: ActionContext) -> AdapterResult:
        nonlocal called
        called = True
        return verified("should not happen")

    events: list[AgentVoiceEvent] = []
    runtime = make_runtime(Scripted(run), events)
    runtime.cancel_conversation(reason="user")

    outcome = await runtime.run_delegated_action(text="do it", title="Do it")
    assert called is False
    assert outcome.result.status == "cancelled"


async def test_cancel_conversation_is_idempotent() -> None:
    events: list[AgentVoiceEvent] = []
    runtime = make_runtime(Scripted(_always_verified), events)
    runtime.cancel_conversation(reason="user")
    runtime.cancel_conversation(reason="error")
    cancelled = [
        cast(ConversationCancelled, e)
        for e in events
        if type(e).__name__ == "ConversationCancelled"
    ]
    assert len(cancelled) == 1
    assert cancelled[0].reason == "user"


async def test_approval_respond_command_resolves_the_matching_pending_approval() -> None:
    async def run(_request: AdapterRequest, ctx: ActionContext) -> AdapterResult:
        decision = await ctx.request_approval(ApprovalRequest(prompt="Proceed?"))
        return verified(f"decision={decision}")

    events: list[AgentVoiceEvent] = []
    runtime = make_runtime(Scripted(run), events)
    task = asyncio.ensure_future(runtime.run_delegated_action(text="do it", title="Do it"))
    await asyncio.sleep(0.01)

    requested = cast(
        ApprovalRequested, next(e for e in events if type(e).__name__ == "ApprovalRequested")
    )
    runtime.handle_command(
        {
            "v": 1,
            "id": "cmd_1",
            "ts": "2024-01-01T00:00:00Z",
            "conversationId": "conv_test",
            "type": "approval.respond",
            "actionId": requested.actionId,
            "approvalId": requested.approvalId,
            "decision": "approved",
        }
    )
    outcome = await task
    assert outcome.result.status == "verified"
    assert outcome.result.summary == "decision=approved"


async def test_malformed_and_unknown_commands_are_ignored_without_raising() -> None:
    events: list[AgentVoiceEvent] = []
    runtime = make_runtime(Scripted(_always_verified), events)

    runtime.handle_command("not json{{{")
    runtime.handle_command({"v": 1, "type": "unknown.thing"})
    runtime.handle_command({"v": 2, "id": "x", "ts": "bad", "conversationId": "c", "type": "x"})
    runtime.handle_command(None)
    runtime.handle_command(b"\xff\xfe not utf8")

    assert events == []


async def test_emit_conversation_started_emits_a_valid_bound_event() -> None:
    events: list[AgentVoiceEvent] = []
    adapter = Scripted(_always_verified, name="openai-http")
    runtime = make_runtime(adapter, events)

    runtime.emit_conversation_started(agent_name="agent-voice")

    assert len(events) == 1
    event = events[0]
    assert isinstance(event, ConversationStarted)
    assert event.agentName == "agent-voice"
    assert event.adapter == "openai-http"
    assert event.conversationId == "conv_test"
    result = parse_event(event.model_dump(mode="json", exclude_none=True))
    assert isinstance(result, Ok)
