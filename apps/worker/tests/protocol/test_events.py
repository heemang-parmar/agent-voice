import pytest
from pydantic import ValidationError

from agent_voice_worker.protocol.events import (
    EVENT_TYPES,
    FAILURE_CODES,
    ActionFailed,
    ActionProgress,
    ActionStarted,
    ActionVerified,
    ApprovalRequested,
    ApprovalResolved,
    ArtifactCreated,
    ConversationCancelled,
    ConversationStarted,
    event_model_for,
    is_event_type,
)

ENVELOPE = {
    "v": 1,
    "id": "evt_1",
    "ts": "2026-09-02T12:00:00Z",
    "conversationId": "conv_1",
}


def test_event_types_lists_all_thirteen_events() -> None:
    assert len(EVENT_TYPES) == 13
    assert "conversation.started" in EVENT_TYPES
    assert "action.verified" in EVENT_TYPES


def test_is_event_type() -> None:
    assert is_event_type("conversation.started") is True
    assert is_event_type("bogus.event") is False


def test_conversation_started_accepts_agent_and_adapter_labels() -> None:
    event = ConversationStarted.model_validate(
        {
            **ENVELOPE,
            "type": "conversation.started",
            "agentName": "agent-voice",
            "adapter": "openai-http",
        }
    )
    assert event.agentName == "agent-voice"


def test_events_are_strict_about_unknown_fields() -> None:
    with pytest.raises(ValidationError):
        ConversationStarted.model_validate(
            {
                **ENVELOPE,
                "type": "conversation.started",
                "agentName": "agent-voice",
                "adapter": "openai-http",
                "extra": "nope",
            }
        )


def test_action_progress_bounds_percent_between_zero_and_a_hundred() -> None:
    ActionProgress.model_validate(
        {
            **ENVELOPE,
            "type": "action.progress",
            "actionId": "act_1",
            "message": "working",
            "percent": 0,
        }
    )
    ActionProgress.model_validate(
        {
            **ENVELOPE,
            "type": "action.progress",
            "actionId": "act_1",
            "message": "working",
            "percent": 100,
        }
    )
    with pytest.raises(ValidationError):
        ActionProgress.model_validate(
            {
                **ENVELOPE,
                "type": "action.progress",
                "actionId": "act_1",
                "message": "working",
                "percent": 101,
            }
        )


def test_action_progress_percent_is_optional() -> None:
    event = ActionProgress.model_validate(
        {**ENVELOPE, "type": "action.progress", "actionId": "act_1", "message": "working"}
    )
    assert event.percent is None


def test_action_started_requires_title_and_adapter() -> None:
    event = ActionStarted.model_validate(
        {
            **ENVELOPE,
            "type": "action.started",
            "actionId": "act_1",
            "title": "Send email",
            "adapter": "openai-http",
        }
    )
    assert event.title == "Send email"


def test_approval_requested_ties_prompt_to_action_and_expiry() -> None:
    event = ApprovalRequested.model_validate(
        {
            **ENVELOPE,
            "type": "approval.requested",
            "actionId": "act_1",
            "approvalId": "apr_1",
            "prompt": "Send the email?",
            "expiresAt": "2026-09-02T12:05:00Z",
        }
    )
    assert event.approvalId == "apr_1"


def test_approval_resolved_decision_enum() -> None:
    for decision in ("approved", "rejected", "expired"):
        ApprovalResolved.model_validate(
            {
                **ENVELOPE,
                "type": "approval.resolved",
                "actionId": "act_1",
                "approvalId": "apr_1",
                "decision": decision,
            }
        )
    with pytest.raises(ValidationError):
        ApprovalResolved.model_validate(
            {
                **ENVELOPE,
                "type": "approval.resolved",
                "actionId": "act_1",
                "approvalId": "apr_1",
                "decision": "maybe",
            }
        )


def test_artifact_created_carries_a_validated_artifact() -> None:
    event = ArtifactCreated.model_validate(
        {
            **ENVELOPE,
            "type": "artifact.created",
            "actionId": "act_1",
            "artifact": {
                "id": "art_1",
                "title": "Report",
                "kind": "link",
                "url": "https://example.com/r",
            },
        }
    )
    assert event.artifact.id == "art_1"


def test_action_verified_requires_verification_state_verified() -> None:
    event = ActionVerified.model_validate(
        {
            **ENVELOPE,
            "type": "action.verified",
            "actionId": "act_1",
            "summary": "Done.",
            "verification": {"state": "verified", "method": "openai-http:response"},
        }
    )
    assert event.verification.state == "verified"
    with pytest.raises(ValidationError):
        ActionVerified.model_validate(
            {
                **ENVELOPE,
                "type": "action.verified",
                "actionId": "act_1",
                "summary": "Done.",
                "verification": {"state": "unverified", "method": "openai-http:response"},
            }
        )


def test_action_failed_requires_a_known_failure_code() -> None:
    assert set(FAILURE_CODES) == {
        "failed",
        "unavailable",
        "timeout",
        "cancelled",
        "rejected",
        "expired",
        "invalid",
    }
    event = ActionFailed.model_validate(
        {
            **ENVELOPE,
            "type": "action.failed",
            "actionId": "act_1",
            "code": "timeout",
            "summary": "The agent took too long to respond, so I stopped waiting.",
            "retryable": True,
        }
    )
    assert event.code == "timeout"
    with pytest.raises(ValidationError):
        ActionFailed.model_validate(
            {
                **ENVELOPE,
                "type": "action.failed",
                "actionId": "act_1",
                "code": "not_a_code",
                "summary": "x",
                "retryable": False,
            }
        )


def test_conversation_cancelled_reason_enum() -> None:
    event = ConversationCancelled.model_validate(
        {**ENVELOPE, "type": "conversation.cancelled", "reason": "user"}
    )
    assert event.reason == "user"
    with pytest.raises(ValidationError):
        ConversationCancelled.model_validate(
            {**ENVELOPE, "type": "conversation.cancelled", "reason": "boredom"}
        )


def test_event_model_for_dispatches_by_type() -> None:
    assert event_model_for("action.failed") is ActionFailed
    assert event_model_for("conversation.started") is ConversationStarted
