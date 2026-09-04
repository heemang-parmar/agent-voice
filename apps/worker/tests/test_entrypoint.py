"""Deterministic, network-free tests for the LiveKit wiring layer.

Nothing here opens a room or talks to OpenAI: `RealtimeModel` construction
is local (it only stores options), and delegation is exercised through
`ConversationRuntime` with a scripted fake adapter, exactly like
`test_runtime.py`.
"""

from __future__ import annotations

from dataclasses import replace
from multiprocessing.reduction import ForkingPickler
from typing import Any, cast
from unittest.mock import AsyncMock

import pytest
from livekit.agents import Agent, AgentSession, ToolError, WorkerOptions, inference

import agent_voice_worker.entrypoint as entrypoint_module
from agent_voice_worker.adapters.openai_http import OpenAiHttpAdapter
from agent_voice_worker.adapters.types import ActionContext, AdapterRequest, AdapterResult
from agent_voice_worker.config import OPTIONAL_ENV, REQUIRED_ENV, WorkerConfig
from agent_voice_worker.entrypoint import (
    AGENT_INSTRUCTIONS,
    build_adapter,
    build_agent,
    build_agent_session,
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
    realtime_provider="openai-realtime",
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


def clear_worker_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in set(REQUIRED_ENV + OPTIONAL_ENV + ("OPENAI_API_KEY",)):
        monkeypatch.delenv(name, raising=False)


def test_build_adapter_returns_the_openai_http_adapter_when_configured() -> None:
    adapter = build_adapter(BASE_CONFIG)
    assert isinstance(adapter, OpenAiHttpAdapter)
    assert adapter.name == "openai-http"


def test_build_adapter_returns_the_null_adapter_when_none_is_configured() -> None:
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


def test_build_realtime_model_rejects_a_missing_openai_key() -> None:
    with pytest.raises(ValueError, match="OPENAI_API_KEY"):
        build_realtime_model(replace(BASE_CONFIG, openai_api_key=None))


async def test_build_agent_session_preserves_the_default_openai_realtime_path() -> None:
    session = build_agent_session(BASE_CONFIG)
    assert isinstance(session._llm, type(build_realtime_model(BASE_CONFIG)))
    assert session._stt is None
    assert session._tts is None


async def test_build_agent_session_uses_low_latency_speech_safe_livekit_stack() -> None:
    config = replace(
        BASE_CONFIG,
        livekit_api_secret="x" * 32,
        openai_api_key=None,
        realtime_provider="livekit-inference",
        realtime_model="google/gemma-4-31b-it",
        realtime_voice="9626c31c-bec5-4cca-baa8-f8ba9e84c8bc",
    )
    session = build_agent_session(config)
    assert isinstance(session, AgentSession)
    assert isinstance(session._stt, inference.STT)
    assert isinstance(session._llm, inference.LLM)
    assert isinstance(session._tts, inference.TTS)
    assert session._stt.model == "deepgram/flux-general"
    assert session._llm.model == "google/gemma-4-31b-it"
    assert session._tts.model == "cartesia/sonic-3-latest"
    assert session._tts._opts.voice == "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc"
    assert not session._expressive
    assert session._opts.use_tts_aligned_transcript is True
    endpointing = session._opts.turn_handling["endpointing"]
    assert endpointing["mode"] == "dynamic"
    assert endpointing["min_delay"] == 0.3
    assert endpointing["max_delay"] == 1.2
    preemptive = session._opts.turn_handling["preemptive_generation"]
    assert preemptive["enabled"] is True
    assert preemptive["preemptive_tts"] is False


async def test_livekit_inference_session_protects_adaptive_barge_in_from_initial_echo() -> None:
    config = replace(
        BASE_CONFIG,
        livekit_api_secret="x" * 32,
        openai_api_key=None,
        realtime_provider="livekit-inference",
        realtime_model="google/gemma-4-31b-it",
        realtime_voice="9626c31c-bec5-4cca-baa8-f8ba9e84c8bc",
    )

    session = build_agent_session(config)

    interruption = session._opts.turn_handling["interruption"]
    assert interruption["enabled"] is True
    assert interruption["mode"] == "adaptive"
    assert interruption["min_duration"] == 0.3
    assert interruption["min_words"] == 0
    assert interruption["resume_false_interruption"] is True
    assert session._opts.aec_warmup_duration == 3.0


def test_build_worker_options_carries_the_fixed_agent_name_and_livekit_credentials() -> None:
    options = build_worker_options(BASE_CONFIG)
    assert isinstance(options, WorkerOptions)
    assert options.agent_name == "agent-voice"
    assert options.ws_url == "wss://livekit.example.test"
    assert options.api_key == "lk_key"
    assert options.api_secret == "lk_secret"
    assert callable(options.entrypoint_fnc)


def test_worker_entrypoint_is_pickleable_for_spawned_job_processes() -> None:
    options = build_worker_options(BASE_CONFIG)
    ForkingPickler.dumps(options.entrypoint_fnc)


async def test_entrypoint_rejects_missing_child_configuration_before_connect(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clear_worker_environment(monkeypatch)
    connect = AsyncMock()
    ctx = cast(Any, type("Context", (), {"connect": connect})())

    with pytest.raises(RuntimeError, match="job process"):
        await entrypoint_module.entrypoint(ctx)
    connect.assert_not_awaited()


async def test_entrypoint_loads_child_environment_and_reaches_the_job_runner(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clear_worker_environment(monkeypatch)
    values = {
        "LIVEKIT_URL": BASE_CONFIG.livekit_url,
        "LIVEKIT_API_KEY": BASE_CONFIG.livekit_api_key,
        "LIVEKIT_API_SECRET": BASE_CONFIG.livekit_api_secret,
        "OPENAI_API_KEY": str(BASE_CONFIG.openai_api_key),
        "AGENT_VOICE_REALTIME_PROVIDER": BASE_CONFIG.realtime_provider,
        "AGENT_VOICE_AGENT_ENDPOINT": str(BASE_CONFIG.agent_endpoint),
    }
    for name, value in values.items():
        monkeypatch.setenv(name, value)
    run_job = AsyncMock()
    monkeypatch.setattr(entrypoint_module, "run_job", run_job)
    ctx = cast(Any, object())

    await entrypoint_module.entrypoint(ctx)

    run_job.assert_awaited_once()
    assert run_job.await_args is not None
    assert run_job.await_args.args[1].realtime_provider == "openai-realtime"


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


def test_agent_instructions_require_natural_spoken_turns() -> None:
    lowered = AGENT_INSTRUCTIONS.lower()
    assert "live spoken dialogue" in lowered
    assert "one to three sentences" in lowered
    assert "one question at a time" in lowered
    assert "vary" in lowered and "opening" in lowered
    assert "do not restate" in lowered
