from agent_voice_worker.adapters.types import (
    ActionContext,
    AdapterRequest,
    AdapterResult,
    ApprovalRequest,
)
from agent_voice_worker.protocol.artifacts import Artifact
from agent_voice_worker.protocol.events import ApprovalDecision, Verification


def test_adapter_request_carries_bounded_conversation_fields() -> None:
    request = AdapterRequest(
        conversation_id="conv_1",
        action_id="act_1",
        text="send the weekly report",
        session_key="agent-voice-local",
    )
    assert request.locale is None


def test_approval_request_expiry_is_optional() -> None:
    request = ApprovalRequest(prompt="Send the email?")
    assert request.expires_in_ms is None


def test_adapter_result_carries_status_and_verification() -> None:
    result = AdapterResult(
        status="verified",
        summary="Done.",
        verification=Verification(state="verified", method="openai-http:response"),
        artifacts=[],
    )
    assert result.status == "verified"
    assert result.code is None


def test_action_context_exposes_cancellation_and_deadline() -> None:
    progress_calls: list[tuple[str, float | None]] = []

    async def request_approval(request: ApprovalRequest) -> ApprovalDecision:
        return "approved"

    def record_progress(message: str, percent: float | None = None) -> None:
        progress_calls.append((message, percent))

    def record_artifact(artifact: Artifact) -> None:
        return None

    context = ActionContext(
        cancelled=lambda: False,
        deadline=1234.0,
        progress=record_progress,
        artifact=record_artifact,
        request_approval=request_approval,
    )
    context.progress("halfway there", 50)
    assert progress_calls == [("halfway there", 50)]
    assert context.deadline == 1234.0
    assert context.cancelled() is False
