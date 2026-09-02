"""Matches approval answers to pending requests.

An answer only counts when it names the exact action *and* approval that is
pending, and each request can be answered once; everything else is ignored.
There is deliberately no way to pre-approve or approve "all". Mirrors
`packages/adapter-sdk/src/approvals.ts`.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass

from agent_voice_worker.protocol.events import ApprovalDecision


@dataclass(frozen=True, slots=True)
class PendingApproval:
    action_id: str
    approval_id: str
    """Epoch milliseconds."""
    expires_at: float


@dataclass(frozen=True, slots=True)
class ApprovalResponse:
    action_id: str
    approval_id: str
    decision: str  # "approved" | "rejected"


def _now_ms() -> float:
    return time.time() * 1000


@dataclass(slots=True)
class _Entry:
    action_id: str
    expires_at: float
    future: asyncio.Future[ApprovalDecision]


class ApprovalBroker:
    def __init__(self) -> None:
        self._pending: dict[str, _Entry] = {}

    async def request(
        self, pending: PendingApproval, cancel_event: asyncio.Event | None = None
    ) -> ApprovalDecision:
        """Registers a request and resolves with the decision, or
        `expired` at `expires_at`."""
        future: asyncio.Future[ApprovalDecision] = asyncio.get_running_loop().create_future()
        self._pending[pending.approval_id] = _Entry(
            action_id=pending.action_id, expires_at=pending.expires_at, future=future
        )

        delay = max(0.0, (pending.expires_at - _now_ms()) / 1000)
        watchers = [asyncio.ensure_future(self._expire_after(delay, pending.approval_id))]
        if cancel_event is not None:
            if cancel_event.is_set():
                self._settle(pending.approval_id, "expired")
            else:
                watchers.append(
                    asyncio.ensure_future(self._expire_on_cancel(cancel_event, pending.approval_id))
                )

        try:
            return await future
        finally:
            for watcher in watchers:
                watcher.cancel()

    async def _expire_after(self, delay: float, approval_id: str) -> None:
        await asyncio.sleep(delay)
        self._settle(approval_id, "expired")

    async def _expire_on_cancel(self, cancel_event: asyncio.Event, approval_id: str) -> None:
        await cancel_event.wait()
        self._settle(approval_id, "expired")

    def _settle(self, approval_id: str, decision: ApprovalDecision) -> None:
        entry = self._pending.pop(approval_id, None)
        if entry is None:
            return
        if not entry.future.done():
            entry.future.set_result(decision)

    def resolve(self, response: ApprovalResponse) -> bool:
        """Applies a user decision. Returns `False` when nothing matching is
        pending."""
        entry = self._pending.get(response.approval_id)
        if entry is None or entry.action_id != response.action_id:
            return False
        if _now_ms() >= entry.expires_at:
            self._settle(response.approval_id, "expired")
            return False
        decision: ApprovalDecision = "approved" if response.decision == "approved" else "rejected"
        self._settle(response.approval_id, decision)
        return True

    def expire_action(self, action_id: str) -> None:
        """Expires every pending approval for an action (used on
        cancellation)."""
        for approval_id in [aid for aid, e in self._pending.items() if e.action_id == action_id]:
            self._settle(approval_id, "expired")

    def pending_for(self, action_id: str) -> list[PendingApproval]:
        return [
            PendingApproval(
                action_id=entry.action_id, approval_id=approval_id, expires_at=entry.expires_at
            )
            for approval_id, entry in self._pending.items()
            if entry.action_id == action_id
        ]
