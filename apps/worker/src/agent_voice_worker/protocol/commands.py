"""Commands received from the UI on the `agent-voice.commands.v1` topic.

Commands travel from the UI to the worker. They are deliberately few: the
UI can answer an approval, cancel one action, or cancel the conversation.
There is no command that grants blanket permissions or changes
configuration. Mirrors `packages/protocol/src/commands.ts`.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import ConfigDict, Field

from agent_voice_worker.protocol.envelope import Envelope, IdStr


class _Command(Envelope):
    model_config = ConfigDict(extra="forbid")


class ApprovalRespond(_Command):
    type: Literal["approval.respond"]
    actionId: IdStr
    approvalId: IdStr
    decision: Literal["approved", "rejected"]


class ActionCancel(_Command):
    type: Literal["action.cancel"]
    actionId: IdStr


class ConversationCancel(_Command):
    type: Literal["conversation.cancel"]


AgentVoiceCommand = Annotated[
    ApprovalRespond | ActionCancel | ConversationCancel, Field(discriminator="type")
]

COMMAND_MODELS: dict[str, type[_Command]] = {
    "approval.respond": ApprovalRespond,
    "action.cancel": ActionCancel,
    "conversation.cancel": ConversationCancel,
}

COMMAND_TYPES: tuple[str, ...] = tuple(COMMAND_MODELS.keys())


def is_command_type(value: str) -> bool:
    return value in COMMAND_MODELS


def command_model_for(command_type: str) -> type[_Command]:
    return COMMAND_MODELS[command_type]
