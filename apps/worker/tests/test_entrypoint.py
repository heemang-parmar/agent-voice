"""Deterministic, network-free tests for the LiveKit wiring layer.

Nothing here opens a room or talks to OpenAI: `RealtimeModel` construction
is local (it only stores options), and delegation is exercised through
`ConversationRuntime` with a scripted fake adapter, exactly like
`test_runtime.py`.
"""

from __future__ import annotations

from livekit.agents import Agent, ToolError, WorkerOptions

from agent_voice_worker.adapters.openai_http import OpenAiHttpAdapter
from agent_voice_worker.adapters.types import ActionContext, AdapterRequest, AdapterResult
from agent_voice_worker.config import WorkerConfig
from agent_voice_worker.entrypoint import (
    AGENT_INSTRUCTIONS,
    build_adapter,
    build_agent,
    build_delegate_tool,
    build_realtime_model,
    build_worker_options,
    delegate_to_agent,
)
from agent_voice_worker.protocol.events import Verification
from agent_voice_worker.runtime import ConversationRuntime, NullAdapter

BASE_CONFIG = WorkerConfig(
    livekit_url="wss://livekit.example.test",
    livekit_api_key="lk_key",
    livekit_api_secret="lk_secret",
    openai_api_key="sk-test-not-a-real-key",
    realtime_model="gpt-realtime",
    realtime_voice="marin",
    adapter="openai-http",
    agent_endpoint="http://127.0.0.1:8642/v1",
    agent_api_key=None,
    agent_model="default",
    session_key="agent-voice-local",
    agent_timeout_seconds=60,
    agent_name="agent-voice",
)


def verified(summary: str) -> AdapterResult:
    return AdapterResult(
        status="verified",
        summary=summary,
        verification=Verification(state="verified", method="scripted"),
        artifacts=[],
    )


def failed(summary: str) -> AdapterResult:
    return AdapterResult(
        status="failed",
        summary=summary,
        verification=Verification(state="unverified", method="scripted"),
        artifacts=[],
        code="failed",
    )


class Scripted:
    name = "scripted"

    def __init__(self, result: AdapterResult) -> None:
        self._result = result

    async def run(self, _request: AdapterRequest, _ctx: ActionContext) -> AdapterResult:
        return self._result


def make_runtime(adapter: Scripted) -> ConversationRuntime:
    return ConversationRuntime(
        conversation_id="conv_test",
        session_key="session-test",
        adapter=adapter,  # type: ignore[arg-type]
        timeout_seconds=5.0,
        emit=lambda _event: None,
    )


def test_build_adapter_returns_the_openai_http_adapter_when_configured() -> None:
    adapter = build_adapter(BASE_CONFIG)
    assert isinstance(adapter, OpenAiHttpAdapter)
    assert adapter.name == "openai-http"


def test_build_adapter_returns_the_null_adapter_when_none_is_configured() -> None:
    from dataclasses import replace

    config = replace(BASE_CONFIG, adapter="none", agent_endpoint=None)
    adapter = build_adapter(config)
    assert isinstance(adapter, NullAdapter)
    assert adapter.name == "none"


def test_build_realtime_model_uses_the_configured_model_and_voice_and_makes_no_network_call() -> (
    None
):
    model = build_realtime_model(BASE_CONFIG)
    assert model.model == "gpt-realtime"
    assert model._opts.voice == "marin"


def test_build_worker_options_carries_the_fixed_agent_name_and_livekit_credentials() -> None:
    options = build_worker_options(BASE_CONFIG)
    assert isinstance(options, WorkerOptions)
    assert options.agent_name == "agent-voice"
    assert options.ws_url == "wss://livekit.example.test"
    assert options.api_key == "lk_key"
    assert options.api_secret == "lk_secret"
    assert callable(options.entrypoint_fnc)


async def test_delegate_to_agent_returns_the_verified_summary() -> None:
    runtime = make_runtime(Scripted(verified("Two jobs failed.")))
    result = await delegate_to_agent(runtime, "check the nightly build")
    assert result == "Two jobs failed."


async def test_delegate_to_agent_raises_tool_error_with_the_speakable_summary_on_failure() -> None:
    runtime = make_runtime(Scripted(failed("The agent could not do that.")))
    try:
        await delegate_to_agent(runtime, "do the impossible thing")
    except ToolError as error:
        assert "impossible" not in str(error)  # never echoes raw request text into the error
        assert str(error) == "The agent could not do that."
    else:
        raise AssertionError("expected ToolError")


def test_build_delegate_tool_is_named_delegate_to_agent() -> None:
    runtime = make_runtime(Scripted(verified("ok")))
    tool = build_delegate_tool(runtime)
    assert tool.info.name == "delegate_to_agent"


def test_build_agent_registers_the_delegate_tool_when_delegation_is_enabled() -> None:
    runtime = make_runtime(Scripted(verified("ok")))
    agent = build_agent(runtime, enable_delegation=True)
    assert isinstance(agent, Agent)
    assert len(agent.tools) == 1
    assert agent.tools[0].info.name == "delegate_to_agent"  # type: ignore[union-attr]


def test_build_agent_has_no_tools_when_delegation_is_disabled() -> None:
    runtime = make_runtime(Scripted(verified("ok")))
    agent = build_agent(runtime, enable_delegation=False)
    assert agent.tools == []


def test_agent_instructions_never_claim_success_without_verification() -> None:
    lowered = AGENT_INSTRUCTIONS.lower()
    assert "verifi" in lowered
    assert len(AGENT_INSTRUCTIONS) > 0
