from collections.abc import Callable
from typing import Any, cast

from livekit.agents import AgentSession, llm
from livekit.agents.voice.events import ConversationItemAddedEvent, UserInputTranscribedEvent

from agent_voice_worker.entrypoint import (
    forward_conversation_item,
    forward_user_transcript,
    wire_session_events,
)
from agent_voice_worker.protocol.events import (
    AgentMessageFinal,
    AgentVoiceEvent,
    UserTranscriptFinal,
    UserTranscriptPartial,
)
from agent_voice_worker.runtime import ConversationRuntime, NullAdapter


def runtime_with(events: list[AgentVoiceEvent]) -> ConversationRuntime:
    ids = iter([f"id_{index}" for index in range(20)])
    return ConversationRuntime(
        conversation_id="room_1",
        session_key="session_1",
        adapter=NullAdapter(),
        timeout_seconds=10,
        emit=events.append,
        new_id=lambda: next(ids),
    )


def test_forwards_interim_and_final_user_transcripts_with_stable_segment_id() -> None:
    events: list[AgentVoiceEvent] = []
    runtime = runtime_with(events)

    forward_user_transcript(
        runtime,
        UserInputTranscribedEvent(transcript="hello", is_final=False, item_id="item_user_1"),
    )
    forward_user_transcript(
        runtime,
        UserInputTranscribedEvent(transcript="hello world", is_final=True, item_id="item_user_1"),
    )

    assert isinstance(events[0], UserTranscriptPartial)
    assert isinstance(events[1], UserTranscriptFinal)
    assert [events[0].segmentId, events[1].segmentId] == ["item_user_1", "item_user_1"]
    assert events[1].text == "hello world"


def test_forwards_assistant_conversation_items_as_final_messages_only() -> None:
    events: list[AgentVoiceEvent] = []
    runtime = runtime_with(events)

    forward_conversation_item(
        runtime,
        ConversationItemAddedEvent(
            item=llm.ChatMessage(id="item_agent_1", role="assistant", content=["Ready."])
        ),
    )
    forward_conversation_item(
        runtime,
        ConversationItemAddedEvent(
            item=llm.ChatMessage(role="user", content=["Ignore duplicate."])
        ),
    )

    assert len(events) == 1
    assert isinstance(events[0], AgentMessageFinal)
    assert events[0].messageId == "item_agent_1"
    assert events[0].text == "Ready."


def test_ignores_empty_assistant_items() -> None:
    events: list[AgentVoiceEvent] = []
    runtime = runtime_with(events)

    forward_conversation_item(
        runtime,
        ConversationItemAddedEvent(
            item=llm.ChatMessage(id="item_agent_2", role="assistant", content=[])
        ),
    )

    assert events == []


class FakeSession:
    def __init__(self) -> None:
        self.handlers: dict[str, Callable[[Any], None]] = {}

    def on(self, event: str, callback: Callable[[Any], None]) -> None:
        self.handlers[event] = callback


def test_wires_both_livekit_transcript_event_sources() -> None:
    events: list[AgentVoiceEvent] = []
    session = FakeSession()

    wire_session_events(cast(AgentSession[Any], session), runtime_with(events))

    assert set(session.handlers) == {"user_input_transcribed", "conversation_item_added"}
