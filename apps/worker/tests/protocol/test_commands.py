import pytest
from pydantic import ValidationError

from agent_voice_worker.protocol.commands import (
    COMMAND_TYPES,
    ActionCancel,
    ApprovalRespond,
    ConversationCancel,
    command_model_for,
    is_command_type,
)

ENVELOPE = {
    "v": 1,
    "id": "cmd_1",
    "ts": "2026-09-02T12:00:00Z",
    "conversationId": "conv_1",
}


def test_command_types_lists_all_three_commands() -> None:
    assert set(COMMAND_TYPES) == {"approval.respond", "action.cancel", "conversation.cancel"}


def test_is_command_type() -> None:
    assert is_command_type("action.cancel") is True
    assert is_command_type("bogus.command") is False


def test_approval_respond_only_accepts_approved_or_rejected() -> None:
    ApprovalRespond.model_validate(
        {
            **ENVELOPE,
            "type": "approval.respond",
            "actionId": "act_1",
            "approvalId": "apr_1",
            "decision": "approved",
        }
    )
    with pytest.raises(ValidationError):
        ApprovalRespond.model_validate(
            {
                **ENVELOPE,
                "type": "approval.respond",
                "actionId": "act_1",
                "approvalId": "apr_1",
                "decision": "expired",
            }
        )


def test_action_cancel_names_exactly_one_action() -> None:
    command = ActionCancel.model_validate(
        {**ENVELOPE, "type": "action.cancel", "actionId": "act_1"}
    )
    assert command.actionId == "act_1"


def test_conversation_cancel_has_no_extra_fields() -> None:
    ConversationCancel.model_validate({**ENVELOPE, "type": "conversation.cancel"})
    with pytest.raises(ValidationError):
        ConversationCancel.model_validate(
            {**ENVELOPE, "type": "conversation.cancel", "actionId": "act_1"}
        )


def test_command_model_for_dispatches_by_type() -> None:
    assert command_model_for("action.cancel") is ActionCancel
    assert command_model_for("conversation.cancel") is ConversationCancel
