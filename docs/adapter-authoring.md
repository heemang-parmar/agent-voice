# Authoring an adapter

An adapter is the only thing standing between the voice layer and a real
tool-using agent. It bridges the `delegate_to_agent` tool call to whatever
agent you're connecting — Hermes, another OpenAI-compatible endpoint, or
something else entirely — and reports back honestly.

`@agent-voice/adapter-openai-http` is the one adapter shipped with test
coverage today. It is a useful reference implementation, and it is designed to
work with Hermes and any other OpenAI-compatible chat/completions endpoint. No
adapter for Claude Code, Codex, OpenClaw, or similar agent CLIs exists yet —
build one following this contract if you need one, and don't describe it as
supported until it has adapter-level test coverage.

## The contract (`@agent-voice/adapter-sdk`)

```ts
export interface AgentAdapter {
  readonly name: string;
  run(request: AdapterRequest, context: ActionContext): Promise<AdapterResult>;
}
```

`AdapterRequest` is already bounded and validated before it reaches your
adapter: `conversationId`, `actionId`, `text` (the user's request, ≤ 4000
chars), a stable `sessionKey`, and an optional `locale`.

`ActionContext` is everything your adapter is allowed to do while it runs:

- `signal: AbortSignal` — cancellation and timeout both surface here. Your
  adapter must be cancellation-safe: stop work and return promptly, or the
  runner will treat you as failed anyway once the deadline passes.
- `deadline: number` — epoch milliseconds after which the action is failed with
  `timeout`. Bound your own I/O to this, don't just rely on the outer signal.
- `progress(message, percent?)` — fire-and-forget. Never throws, never blocks.
- `artifact(artifact)` — attach a `link`, `file`, or `text` artifact. Capped at
  20 per action; extras are silently dropped.
- `requestApproval(request)` — returns a `Promise<ApprovalDecision>`
  (`approved` | `rejected` | `expired`). Every request is bound to the current
  action and expires (default: the lesser of 120s and the remaining deadline,
  or `request.expiresInMs` if you set one). There is no way to request a
  standing or blanket approval — don't try to work around that by asking once
  and reusing the answer for later actions.

`AdapterResult`:

```ts
export type AdapterStatus = 'verified' | 'failed' | 'unavailable' | 'cancelled';

export interface AdapterResult {
  status: AdapterStatus;
  summary: string;              // short, speakable, user-facing — never raw error text
  verification: Verification;   // must be { state: 'verified', ... } for status: 'verified'
  artifacts: Artifact[];
  code?: FailureCode;
  retryable?: boolean;
}
```

**The runner enforces the verification rule for you, not just by convention.**
If you return `status: 'verified'` without `verification.state === 'verified'`,
`runAction` downgrades the result to `action.failed` with a generic "could not
be verified" summary before it ever reaches the wire. Don't try to route around
this — if you can't verify it, return `failed`, `unavailable`, or `cancelled`
honestly.

## What the runner does for you

`runAction` (`packages/adapter-sdk/src/run-action.ts`) is the only place that
turns adapter behavior into protocol events, and it guarantees:

- Exactly one `action.started`, exactly one terminal event
  (`action.verified`/`action.failed`), nothing emitted after the terminal event.
- A hard deadline (`timeoutMs`) and external cancellation both map to `timeout`
  / `cancelled` failures — your adapter throwing past its deadline doesn't leak
  an extra event.
- Every event is bounded and clamped (text truncated to `LIMITS.maxTextChars`,
  labels to `maxLabelChars`, etc.) before being emitted, so a misbehaving
  adapter can't produce an oversize or malformed event.
- Generic, non-leaking summaries (`GENERIC_SUMMARIES`) for every failure code —
  your adapter's exception message never reaches the transcript or the logs
  through the runner; log it yourself, redacted, if you need to debug it.
- Approval matching through `ApprovalBroker`: an answer only resolves the
  pending request that names the same `actionId` **and** `approvalId`; anything
  else is ignored.

Your adapter should not try to duplicate any of this — emit progress and
artifacts through `context`, request approval through `context`, and return a
result. Let the runner handle events, ids, timestamps, and bounds.

## Writing a new HTTP-style adapter

Use `OpenAiHttpAdapterOptions` in `packages/adapter-openai-http/src/adapter.ts`
as the shape to imitate:

1. **Validate configuration at construction, not per-request.** The reference
   adapter rejects a non-`http(s)` endpoint immediately rather than on first
   call.
2. **Bound everything.** Request body, response body (`maxResponseBytes`,
   default 256 KiB), and time (`timeoutMs`, further capped by
   `context.deadline`) all have explicit caps in the reference adapter. Do the
   same for your transport.
3. **Never log or echo the bearer key, the raw response body, or upstream error
   text.** Log only event names and scalar fields (see `AdapterLogger`) — the
   exception class name, an HTTP status code, a byte count. Nothing that could
   contain the payload.
4. **Distinguish `unavailable` (transport/5xx/429 — retry might help) from
   `failed` (4xx / malformed output — retry won't help) from `cancelled`
   (the signal fired).** Callers and the UI use this to decide whether to offer
   retry.
5. **Support dependency injection for tests.** The reference adapter takes
   `fetch` as an option specifically so tests can supply a deterministic mock
   instead of hitting a network.
6. **Use the stable session key** (`AdapterRequest.sessionKey`) as a request
   header or field so the far end can maintain memory across turns — don't
   invent your own session identifier.
7. **Require an explicit structured verification attestation.** The shipped HTTP adapter accepts
   only a JSON object in `choices[0].message.content` with exactly `status`,
   `summary`, and `verification`. A verified status must carry a verified state
   and a non-empty method. Unknown fields, contradictory status/evidence,
   unstructured prose, oversize values, and truncated completions fail closed.

The adapter validates this envelope; it does not independently reproduce the
agent's tool check. A `verified` result therefore trusts the operator-configured
delegated agent and its stated method. Only connect endpoints you trust to
execute and verify actions honestly. Optional `detail` must be omitted rather
than set to `null`.

```json
{
  "status": "verified",
  "summary": "The requested action completed.",
  "verification": {
    "state": "verified",
    "method": "agent:tool-result"
  }
}
```

## Testing expectations

Before describing a new adapter as supported (not just "planned"), match the
coverage `adapter-openai-http`'s test suite has (see
`packages/adapter-openai-http/test/openai-http-adapter.test.ts` and
`docs/verification.md`, Slice 6): request shape, size bounds on both directions,
HTTP error class mapping, malformed/empty upstream output, abort/cancellation,
and a check that upstream response bodies and bearer keys never reach a result
or a log line. Update the compatibility matrix in the root `README.md` only
once that coverage exists and passes.

## Python (worker-side) adapters

The worker ships a Python implementation of the same delegate-agent bridge.
It uses the same bounded request, strict structured-result contract,
verification consistency rule, cancellation semantics, and failure mapping as
the TypeScript adapter. Both implementations have mirrored adapter tests.
