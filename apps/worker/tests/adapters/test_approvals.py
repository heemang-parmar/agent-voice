import asyncio
import time

from agent_voice_worker.adapters.approvals import ApprovalBroker, ApprovalResponse, PendingApproval


def _now_ms() -> float:
    return time.time() * 1000


async def test_resolve_settles_a_matching_pending_request() -> None:
    broker = ApprovalBroker()
    pending = PendingApproval(action_id="act_1", approval_id="apr_1", expires_at=_now_ms() + 5000)
    task = asyncio.ensure_future(broker.request(pending))
    await asyncio.sleep(0)  # let request() register the pending entry

    assert (
        broker.resolve(
            ApprovalResponse(action_id="act_1", approval_id="apr_1", decision="approved")
        )
        is True
    )
    assert await task == "approved"


async def test_resolve_ignores_a_response_naming_the_wrong_action() -> None:
    broker = ApprovalBroker()
    pending = PendingApproval(action_id="act_1", approval_id="apr_1", expires_at=_now_ms() + 5000)
    task = asyncio.ensure_future(broker.request(pending))
    await asyncio.sleep(0)

    assert (
        broker.resolve(
            ApprovalResponse(action_id="act_2", approval_id="apr_1", decision="approved")
        )
        is False
    )
    assert (
        broker.resolve(
            ApprovalResponse(action_id="act_1", approval_id="apr_1", decision="rejected")
        )
        is True
    )
    assert await task == "rejected"


async def test_resolve_ignores_a_response_for_an_unknown_approval() -> None:
    broker = ApprovalBroker()
    assert (
        broker.resolve(
            ApprovalResponse(action_id="act_1", approval_id="apr_missing", decision="approved")
        )
        is False
    )


async def test_each_pending_request_can_only_be_answered_once() -> None:
    broker = ApprovalBroker()
    pending = PendingApproval(action_id="act_1", approval_id="apr_1", expires_at=_now_ms() + 5000)
    task = asyncio.ensure_future(broker.request(pending))
    await asyncio.sleep(0)

    assert (
        broker.resolve(
            ApprovalResponse(action_id="act_1", approval_id="apr_1", decision="approved")
        )
        is True
    )
    assert (
        broker.resolve(
            ApprovalResponse(action_id="act_1", approval_id="apr_1", decision="rejected")
        )
        is False
    )
    assert await task == "approved"


async def test_request_expires_on_its_own_when_no_one_answers() -> None:
    broker = ApprovalBroker()
    pending = PendingApproval(action_id="act_1", approval_id="apr_1", expires_at=_now_ms() + 20)
    decision = await broker.request(pending)
    assert decision == "expired"


async def test_resolve_after_expiry_reports_expired_and_returns_false() -> None:
    broker = ApprovalBroker()
    pending = PendingApproval(action_id="act_1", approval_id="apr_1", expires_at=_now_ms() + 20)
    task = asyncio.ensure_future(broker.request(pending))
    await asyncio.sleep(0.05)

    assert (
        broker.resolve(
            ApprovalResponse(action_id="act_1", approval_id="apr_1", decision="approved")
        )
        is False
    )
    assert await task == "expired"


async def test_expire_action_settles_every_pending_approval_for_that_action() -> None:
    broker = ApprovalBroker()
    first = asyncio.ensure_future(
        broker.request(
            PendingApproval(action_id="act_1", approval_id="apr_1", expires_at=_now_ms() + 5000)
        )
    )
    second = asyncio.ensure_future(
        broker.request(
            PendingApproval(action_id="act_1", approval_id="apr_2", expires_at=_now_ms() + 5000)
        )
    )
    other = asyncio.ensure_future(
        broker.request(
            PendingApproval(action_id="act_2", approval_id="apr_3", expires_at=_now_ms() + 5000)
        )
    )
    await asyncio.sleep(0)

    broker.expire_action("act_1")

    assert await first == "expired"
    assert await second == "expired"
    assert broker.pending_for("act_2") != []
    broker.expire_action("act_2")
    assert await other == "expired"


async def test_pending_for_lists_only_that_actions_requests() -> None:
    broker = ApprovalBroker()
    first = asyncio.ensure_future(
        broker.request(
            PendingApproval(action_id="act_1", approval_id="apr_1", expires_at=_now_ms() + 5000)
        )
    )
    second = asyncio.ensure_future(
        broker.request(
            PendingApproval(action_id="act_2", approval_id="apr_2", expires_at=_now_ms() + 5000)
        )
    )
    await asyncio.sleep(0)

    pending = broker.pending_for("act_1")
    assert [p.approval_id for p in pending] == ["apr_1"]

    broker.expire_action("act_1")
    broker.expire_action("act_2")
    assert await first == "expired"
    assert await second == "expired"


async def test_cancel_event_expires_the_request_immediately() -> None:
    broker = ApprovalBroker()
    cancel = asyncio.Event()
    pending = PendingApproval(action_id="act_1", approval_id="apr_1", expires_at=_now_ms() + 5000)
    task = asyncio.ensure_future(broker.request(pending, cancel))
    await asyncio.sleep(0)
    cancel.set()
    decision = await asyncio.wait_for(task, timeout=1)
    assert decision == "expired"
