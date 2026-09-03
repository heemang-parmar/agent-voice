"""Wires the versioned protocol and the adapter runner into a real LiveKit
Agents worker: a configured realtime provider for conversation, a bounded
`delegate_to_agent` tool for everything else. Nothing in this module makes a
network call at import time or at construction time — connections only
happen once LiveKit invokes `entrypoint(ctx)` inside a real job.
"""

from __future__ import annotations

import asyncio
import os
from collections.abc import Coroutine
from typing import Any

from livekit import rtc
from livekit.agents import (
    Agent,
    AgentSession,
    FunctionTool,
    JobContext,
    ToolError,
    WorkerOptions,
    function_tool,
    inference,
    llm,
)
from livekit.agents.voice.events import ConversationItemAddedEvent, UserInputTranscribedEvent
from livekit.plugins import openai

from agent_voice_worker.adapters.openai_http import OpenAiHttpAdapter, OpenAiHttpAdapterOptions
from agent_voice_worker.adapters.run_action import default_new_id
from agent_voice_worker.adapters.types import AgentAdapter
from agent_voice_worker.config import ConfigErr, WorkerConfig, load_worker_config
from agent_voice_worker.protocol.events import AgentVoiceEvent
from agent_voice_worker.protocol.limits import TOPICS
from agent_voice_worker.protocol.parse import ProtocolEncodeError, encode_event
from agent_voice_worker.runtime import ConversationRuntime, NullAdapter

AGENT_INSTRUCTIONS = (
    "You are a helpful, concise voice assistant. Handle ordinary conversation yourself. "
    "For anything that needs memory, current facts, calculations, files, code, scheduling, "
    "or an external action, call delegate_to_agent instead of guessing. Never tell the user "
    "something was done, changed, or scheduled unless delegate_to_agent actually returned a "
    "verified result — if it failed or you did not call it, say so plainly."
)

DELEGATE_TOOL_DESCRIPTION = (
    "Delegate a task that requires memory, current facts, calculations, files, code, "
    "scheduling, or an external action to the connected agent. Only call this when the "
    "user's request needs real work done, not for ordinary conversation. Returns the "
    "agent's verified summary, or raises if the agent could not complete it."
)

INFERENCE_STT_MODEL = "deepgram/flux-general"
INFERENCE_TTS_MODEL = "xai/tts-1"


def build_adapter(config: WorkerConfig) -> AgentAdapter:
    if config.adapter == "none":
        return NullAdapter()
    assert config.agent_endpoint is not None  # enforced by load_worker_config
    return OpenAiHttpAdapter(
        OpenAiHttpAdapterOptions(
            endpoint=config.agent_endpoint,
            api_key=config.agent_api_key,
            model=config.agent_model,
            timeout_seconds=float(config.agent_timeout_seconds),
        )
    )


def build_realtime_model(config: WorkerConfig) -> openai.realtime.RealtimeModel:
    if config.openai_api_key is None:
        raise ValueError("OPENAI_API_KEY is required for the OpenAI Realtime provider")
    return openai.realtime.RealtimeModel(
        model=config.realtime_model,
        voice=config.realtime_voice,
        api_key=config.openai_api_key,
    )


def build_agent_session(config: WorkerConfig) -> AgentSession[Any]:
    if config.realtime_provider == "livekit-inference":
        return AgentSession(
            stt=inference.STT(
                model=INFERENCE_STT_MODEL,
                language="en",
                api_key=config.livekit_api_key,
                api_secret=config.livekit_api_secret,
            ),
            llm=inference.LLM(
                model=config.realtime_model,
                api_key=config.livekit_api_key,
                api_secret=config.livekit_api_secret,
            ),
            tts=inference.TTS(
                model=INFERENCE_TTS_MODEL,
                voice=config.realtime_voice,
                language="en",
                api_key=config.livekit_api_key,
                api_secret=config.livekit_api_secret,
            ),
        )
    return AgentSession(llm=build_realtime_model(config))


async def delegate_to_agent(runtime: ConversationRuntime, request: str) -> str:
    """The tool's actual logic, kept independent of the LiveKit `RunContext`
    so it can be unit-tested directly."""
    title = request if len(request) <= 80 else f"{request[:79]}…"
    outcome = await runtime.run_delegated_action(text=request, title=title)
    if outcome.result.status == "verified":
        return outcome.result.summary
    raise ToolError(outcome.result.summary)


def build_delegate_tool(
    runtime: ConversationRuntime,
) -> FunctionTool[[str], Coroutine[Any, Any, str]]:
    @function_tool(name="delegate_to_agent", description=DELEGATE_TOOL_DESCRIPTION)
    async def delegate_to_agent_tool(request: str) -> str:
        return await delegate_to_agent(runtime, request)

    return delegate_to_agent_tool


def build_agent(runtime: ConversationRuntime, *, enable_delegation: bool) -> Agent:
    tools: list[llm.Tool | llm.Toolset] = (
        [build_delegate_tool(runtime)] if enable_delegation else []
    )
    return Agent(instructions=AGENT_INSTRUCTIONS, tools=tools)


def forward_user_transcript(
    runtime: ConversationRuntime,
    event: UserInputTranscribedEvent,
    *,
    segment_id: str | None = None,
) -> None:
    text = event.transcript.strip()
    if not text:
        return
    runtime.emit_user_transcript(
        segment_id=segment_id or event.item_id or f"segment_{default_new_id()}",
        text=text,
        is_final=event.is_final,
    )


def forward_conversation_item(
    runtime: ConversationRuntime,
    event: ConversationItemAddedEvent,
) -> None:
    item = event.item
    if not isinstance(item, llm.ChatMessage) or item.role != "assistant":
        return
    text = (item.text_content or "").strip()
    if not text:
        return
    runtime.emit_agent_message(message_id=item.id, text=text)


def wire_session_events(session: AgentSession[Any], runtime: ConversationRuntime) -> None:
    active_segment_id: str | None = None

    def on_user_input(event: UserInputTranscribedEvent) -> None:
        nonlocal active_segment_id
        segment_id = active_segment_id or event.item_id or f"segment_{default_new_id()}"
        forward_user_transcript(runtime, event, segment_id=segment_id)
        active_segment_id = None if event.is_final else segment_id

    session.on("user_input_transcribed", on_user_input)
    session.on(
        "conversation_item_added",
        lambda event: forward_conversation_item(runtime, event),
    )


async def entrypoint(ctx: JobContext) -> None:
    """Spawn-safe LiveKit job entrypoint.

    LiveKit serializes this callback when it launches job processes. Keeping it
    at module scope makes it pickleable on spawn-based platforms such as macOS.
    The child inherits the worker environment and validates it independently.
    """
    result = load_worker_config(dict(os.environ))
    if isinstance(result, ConfigErr):
        names = ", ".join(sorted(set(result.missing + result.invalid)))
        raise RuntimeError(f"worker configuration is unavailable in the job process: {names}")
    await run_job(ctx, result.config)


async def run_job(ctx: JobContext, config: WorkerConfig) -> None:
    await ctx.connect()

    adapter = build_adapter(config)
    conversation_id = ctx.room.name or default_new_id()

    publish_tasks: set[asyncio.Task[None]] = set()

    def publish_event(event: AgentVoiceEvent) -> None:
        try:
            payload = encode_event(event)
        except ProtocolEncodeError:
            return
        task = asyncio.create_task(
            ctx.room.local_participant.publish_data(
                payload,
                reliable=True,
                topic=TOPICS.events,
            )
        )
        publish_tasks.add(task)
        task.add_done_callback(publish_tasks.discard)

    runtime = ConversationRuntime(
        conversation_id=conversation_id,
        session_key=config.session_key,
        adapter=adapter,
        timeout_seconds=float(config.agent_timeout_seconds),
        emit=publish_event,
    )

    def on_data_received(packet: rtc.DataPacket) -> None:
        if packet.topic == TOPICS.commands:
            runtime.handle_command(packet.data)

    ctx.room.on("data_received", on_data_received)

    session = build_agent_session(config)
    wire_session_events(session, runtime)
    agent = build_agent(runtime, enable_delegation=config.adapter != "none")
    await session.start(agent=agent, room=ctx.room)
    runtime.emit_conversation_started(agent_name=config.agent_name)


def build_worker_options(config: WorkerConfig) -> WorkerOptions:
    return WorkerOptions(
        entrypoint_fnc=entrypoint,
        agent_name=config.agent_name,
        ws_url=config.livekit_url,
        api_key=config.livekit_api_key,
        api_secret=config.livekit_api_secret,
    )
