# Protocol: events and commands

The wire contract lives in `@agent-voice/protocol` (`packages/protocol`). It is
the only thing the browser and the worker share, and it is deliberately small,
strict, and versioned. This document describes the contract; the schemas
themselves (`packages/protocol/src/*.ts`) and their fixtures
(`packages/protocol/fixtures/`) are authoritative if this document ever drifts.

## Envelope

Every event and command extends the same envelope:

| Field | Type | Notes |
| --- | --- | --- |
| `v` | literal `1` | Protocol version. A version mismatch is a parse failure, not a best-effort upgrade. |
| `id` | bounded id string | Opaque, printable, ≤ 64 chars, `[A-Za-z0-9][A-Za-z0-9._:-]*`. |
| `ts` | ISO-8601 datetime with offset | |
| `conversationId` | bounded id string | Same shape as `id`. |
| `type` | string | Refined to a literal per concrete schema. |

Every concrete event and command schema is `.strict()`: unknown extra keys are
rejected rather than silently dropped. This means a producer can never smuggle
an unvalidated field past a consumer by accident.

## Limits (`packages/protocol/src/limits.ts`)

| Limit | Value | Applies to |
| --- | --- | --- |
| `maxEventBytes` | 12 KiB | Total encoded size of one event or command |
| `maxIdChars` | 64 | Every id field |
| `maxLabelChars` | 200 | Short labels: agent/adapter names, titles, methods |
| `maxTextChars` | 4000 | Transcript text, agent messages, speakable summaries |
| `maxMessageChars` | 1000 | Progress messages, approval prompts |
| `maxUrlChars` | 2048 | Artifact URLs |
| `maxArtifacts` | 20 | Artifacts per event |
| `maxArtifactTextChars` | 4000 | Inline artifact text |

Data-channel topics: `agent-voice.events.v1` (server → client) and
`agent-voice.commands.v1` (client → server).

## Events

| Type | Key fields | Meaning |
| --- | --- | --- |
| `conversation.started` | `agentName`, `adapter` | Session is live; which worker identity and adapter are in play. |
| `user.transcript.partial` / `.final` | `segmentId`, `text` | Live transcription of the human side, streaming then finalized per segment. |
| `agent.message.partial` / `.final` | `messageId`, `text` | The realtime model's own spoken/text turns. |
| `action.started` | `actionId`, `title`, `adapter` | A `delegate_to_agent` call began. |
| `action.progress` | `actionId`, `message`, `percent?` | Optional, fire-and-forget progress from the adapter. |
| `approval.requested` | `actionId`, `approvalId`, `prompt`, `expiresAt` | Bounded to one action; always has an expiry. There is no unscoped approval. |
| `approval.resolved` | `actionId`, `approvalId`, `decision` (`approved`\|`rejected`\|`expired`), `resolvedBy?` | Answers exactly the approval it names; late/mismatched answers are ignored by the runner. |
| `artifact.created` | `actionId`, `artifact` | A link, file, or inline-text artifact produced during the action. |
| `action.verified` | `actionId`, `summary`, `verification` (state pinned to `verified`), `artifacts?` | The only event that lets the UI say "done." |
| `action.failed` | `actionId`, `code`, `summary`, `retryable` | Honest, generic failure — never raw upstream text. |
| `conversation.cancelled` | `reason` (`user`\|`agent`\|`error`\|`timeout`), `detail?` | Session-level cancellation. |

`FAILURE_CODES`: `failed`, `unavailable`, `timeout`, `cancelled`, `rejected`,
`expired`, `invalid`. These are the only reasons an action can end without being
verified, and they map directly to `AdapterStatus` in
[adapter-authoring.md](adapter-authoring.md).

### Artifacts

An artifact is one of `link`, `file`, or `text` (`packages/protocol/src/artifacts.ts`),
each with an `id` and `title`. `link` and `file` artifacts carry a URL that must
pass `isSafeArtifactUrl`: absolute, `http:`/`https:` only, no embedded
credentials (`user:pass@host`), no whitespace, within `maxUrlChars`. Anything
else — `javascript:`, `data:`, `blob:`, `file:`, relative paths — is rejected at
the schema boundary, so the UI never has to make that judgment call at render
time. Artifact content comes from the delegated agent and must always be treated
as untrusted data.

## Commands

Commands travel from the UI to the worker. There are exactly three, and none of
them grants standing or future permission:

| Type | Key fields | Effect |
| --- | --- | --- |
| `approval.respond` | `actionId`, `approvalId`, `decision` (`approved`\|`rejected`) | Answers one specific approval request. |
| `action.cancel` | `actionId` | Cancels one in-flight action. |
| `conversation.cancel` | — | Ends the session. |

## Validation and forward compatibility

- Parsing is exhaustive: a payload either matches exactly one known event/command
  schema or it is rejected with a reason (invalid JSON, oversize, wrong version,
  malformed id, unknown/extra field, or unrecognized `type`).
- An unrecognized `type` on an otherwise well-formed envelope is treated as
  "unknown, ignore" by consumers built against this contract — new event types
  can be added in a future minor revision without breaking older clients, as
  long as the envelope and `v` stay the same.
- `packages/protocol/fixtures/{events,commands,invalid}` contains one valid
  fixture per known type plus invalid fixtures with a declared rejection reason;
  `packages/protocol/test/fixtures-conformance.test.ts` enforces that every event
  type has a fixture and that every invalid fixture is actually rejected.
  `packages/protocol/fixtures/scenarios/*.json` provides ordered event sequences
  used to drive the UI's playback/demo mode without a live worker.

## Adding a new event or command

1. Add the schema in `packages/protocol/src/events.ts` or `commands.ts` using
   `defineEvent`/`defineCommand`, with explicit bounds on every new field (reuse
   `idSchema`, `labelSchema`, `textSchema`, `messageSchema`, or add a new bounded
   schema — never an unbounded `z.string()`).
2. Add at least one valid fixture and, if it introduces a new failure mode, an
   invalid fixture with its rejection reason.
3. Run `pnpm --filter @agent-voice/protocol generate:fixtures` and the package's
   tests.
4. If the worker needs to understand the new type, update its Python
   conformance test against the same fixtures (see `CONTRIBUTING.md`).
