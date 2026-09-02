"""Wires the versioned protocol and the adapter runner into a real LiveKit
Agents worker: OpenAI Realtime for the conversational turn, a bounded
`delegate_to_agent` tool for everything else. Nothing in this module makes a
network call at import time or at construction time — connections only
happen once LiveKit invokes `entrypoint(ctx)` inside a real job.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Coroutine
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
    llm,
)
from livekit.agents.voice.events import ConversationItemAddedEvent, UserInputTranscribedEvent
from livekit.plugins import openai

from agent_voice_worker.adapters.openai_http import OpenAiHttpAdapter, OpenAiHttpAdapterOptions
from agent_voice_worker.adapters.run_action import default_new_id
from agent_voice_worker.adapters.types import AgentAdapter
from agent_voice_worker.config import WorkerConfig
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
    return openai.realtime.RealtimeModel(
        model=config.realtime_model,
        voice=config.realtime_voice,
        api_key=config.openai_api_key,
    )


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
) -> None:
    text = event.transcript.strip()
    if not text:
        return
    runtime.emit_user_transcript(
        segment_id=event.item_id or f"segment_{default_new_id()}",
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
    session.on(
        "user_input_transcribed",
        lambda event: forward_user_transcript(runtime, event),
    )
    session.on(
        "conversation_item_added",
        lambda event: forward_conversation_item(runtime, event),
    )


def _make_entrypoint(config: WorkerConfig) -> Callable[[JobContext], Awaitable[None]]:
    async def entrypoint(ctx: JobContext) -> None:
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

        session = AgentSession[None](llm=build_realtime_model(config))
        wire_session_events(session, runtime)
        agent = build_agent(runtime, enable_delegation=config.adapter != "none")
        await session.start(agent=agent, room=ctx.room)
        runtime.emit_conversation_started(agent_name=config.agent_name)

    return entrypoint


def build_worker_options(config: WorkerConfig) -> WorkerOptions:
    return WorkerOptions(
        entrypoint_fnc=_make_entrypoint(config),
        agent_name=config.agent_name,
        ws_url=config.livekit_url,
        api_key=config.livekit_api_key,
        api_secret=config.livekit_api_secret,
    )
