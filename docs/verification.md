# Verification log

This file records the real RED → GREEN cycles and quality-gate runs performed while
building this repository. Every command below was executed locally in the listed
working directory; results are pasted from the actual output (trimmed to the relevant
lines). Nothing here is reconstructed after the fact.

Conventions:

- `cwd` is relative to the repository root.
- Tokens, keys and request bodies are never printed; only exit codes, counts and
  status lines are recorded.

## Slice 1 — protocol: parse a `conversation.started` event, reject unknown types

**RED** — `cwd: packages/protocol`

```
$ pnpm exec vitest --run
Error: Failed to load url ../src/index.ts (resolved id: ../src/index.ts) in
  test/parse-event.test.ts. Does the file exist?
 Test Files  1 failed (1)
      Tests  no tests
```

**GREEN** — after adding `src/limits.ts`, `src/envelope.ts`, `src/events.ts`, `src/parse.ts`, `src/index.ts`

```
$ pnpm exec vitest --run
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

## Slice 2 — protocol: envelope failure modes (json, size, version, ids, strict shape)

**RED** — `cwd: packages/protocol` (`test/envelope.test.ts` added)

```
$ pnpm exec vitest --run
 × rejects unknown extra fields on a known event
 AssertionError: expected { ok: true, … } to match object { ok: false, reason: 'invalid_event' }
 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 9 passed (10)
```

**GREEN** — event schemas made strict via `defineEvent()` in `src/events.ts`

```
$ pnpm exec vitest --run
 Test Files  2 passed (2)
      Tests  10 passed (10)
```

## Slice 3 — protocol: full event + command catalogue, fixture conformance

Fixtures written first under `packages/protocol/fixtures/{events,commands,invalid}`;
`test/fixtures-conformance.test.ts` requires one valid fixture per event type, every
command fixture to parse, and every invalid fixture to be rejected with its declared reason.

**RED** — `cwd: packages/protocol`

```
$ pnpm exec vitest --run
 × ships exactly one valid fixture per event type
 × parses valid event fixture 'action.failed.json'
 … (parseCommand is not exported; only conversation.started is defined)
 Test Files  1 failed | 2 passed (3)
      Tests  29 failed | 13 passed (42)
```

**GREEN** — `src/artifacts.ts`, `src/commands.ts`, full `src/events.ts`, `parseCommand`/`encode*` in `src/parse.ts`

```
$ pnpm exec vitest --run
 Test Files  3 passed (3)
      Tests  42 passed (42)
$ pnpm run lint      # exit 0
$ pnpm run typecheck # exit 0
```

Regression coverage added afterwards (no RED expected; these pin behaviour already
implemented in the slice): `test/artifacts-and-encoding.test.ts` — 20 cases, passed first run
(62 total).

## Slice 4 — protocol: typed fixture module + scenario fixtures for UI playback

**RED** — `cwd: packages/protocol` (`test/fixtures-module.test.ts` added)

```
$ pnpm exec vitest --run test/fixtures-module.test.ts
Error: Cannot find module '../src/fixtures.js'
 Test Files  1 failed (1)
      Tests  no tests
```

**GREEN** — `fixtures/scenarios/*.json`, `scripts/generate-fixtures.mjs`, `src/fixtures.generated.ts`, `src/fixtures.ts`

```
$ pnpm exec vitest --run
 Test Files  5 passed (5)
      Tests  67 passed (67)
$ pnpm run lint && pnpm run typecheck && pnpm run build   # all exit 0
```

## Slice 5 — adapter-sdk: action runner, approval broker, bounded events

**RED** — `cwd: packages/adapter-sdk` (`test/run-action.test.ts` written first: 8 cases)

```
$ pnpm exec vitest --run
Error: Cannot find module '../src/index.js'
 Test Files  1 failed (1)
      Tests  no tests
```

**GREEN** — `src/types.ts`, `src/approvals.ts`, `src/run-action.ts`, `src/index.ts`

```
$ pnpm exec vitest --run
 Test Files  1 passed (1)
      Tests  8 passed (8)
$ pnpm run lint && pnpm run typecheck && pnpm run build   # all exit 0 (after fixing 5 lint findings)
```

## Slice 6 — adapter-openai-http: OpenAI-compatible HTTP delegation (Hermes-ready)

**RED** — `cwd: packages/adapter-openai-http` (`test/openai-http-adapter.test.ts` written first: 17 cases)

```
$ pnpm exec vitest --run
Error: Cannot find module '../src/index.js' imported from .../test/openai-http-adapter.test.ts
 Test Files  1 failed (1)
      Tests  no tests
```

**GREEN** — `src/adapter.ts`, `src/index.ts`

```
$ pnpm exec vitest --run
 Test Files  1 passed (1)
      Tests  17 passed (17)
$ pnpm run lint       # exit 0 (after fixing 4 unsafe-any findings in readBounded and rewriting the fetch mock to be typed)
$ pnpm run typecheck  # exit 0
$ pnpm run build      # exit 0
```

Covered: request shape (POST, bearer + session headers, `stream:false`, `user`), list-of-parts content,
HTTP 5xx/429 → `unavailable`, 4xx → `failed`, upstream bodies never reach results or logs, transport
errors log only the error class name, declared and streamed oversize → `failed/invalid`, malformed or
empty completions → `failed`, abort → `cancelled`, non-http endpoints rejected at construction.
Structured action results must contain consistent status and verification evidence; plain prose,
unknown fields, oversize values, contradictory evidence, and `finish_reason=length` fail closed.

## Slice W1 — web: server configuration by name only

**RED** — `cwd: apps/web` (`test/server/env.test.ts` written first: 8 cases)

```
$ pnpm exec vitest --run test/server/env.test.ts
Error: Failed to resolve import "@/lib/server/env" from "test/server/env.test.ts". Does the file exist?
 Test Files  1 failed (1)
      Tests  no tests
```

**GREEN** — `lib/server/env.ts`, `test/stubs/server-only.ts` + vitest alias for the `server-only` guard
(added `server-only@^0.0.1` to `apps/web`)

```
$ pnpm exec vitest --run test/server/env.test.ts
 Test Files  1 passed (1)
      Tests  8 passed (8)
```

## Slice W2 — web: same-origin check with fetch metadata

**RED** — `test/server/origin.test.ts` written first: 7 cases

```
$ pnpm exec vitest --run test/server/origin.test.ts
Error: Failed to resolve import "@/lib/server/origin" from "test/server/origin.test.ts". Does the file exist?
 Test Files  1 failed (1)
      Tests  no tests
```

**GREEN** — `lib/server/origin.ts`

```
$ pnpm exec vitest --run test/server/origin.test.ts
 Test Files  1 failed (1)
      Tests  1 failed | 6 passed (7)      # uppercase-host Origin was classified malformed_origin, not origin_not_allowed
$ pnpm exec vitest --run test/server/origin.test.ts
 Test Files  1 passed (1)
      Tests  7 passed (7)                 # test expectation corrected: still a 403, browsers only send lowercase hosts
```

## Slice W3 — web: bounded in-memory rate limiter

**RED** — `test/server/rate-limit.test.ts` written first: 5 cases

```
$ pnpm exec vitest --run test/server/rate-limit.test.ts
Error: Failed to resolve import "@/lib/server/rate-limit" from "test/server/rate-limit.test.ts". Does the file exist?
 Test Files  1 failed (1)
      Tests  no tests
```

**GREEN** — `lib/server/rate-limit.ts`

```
$ pnpm exec vitest --run test/server/rate-limit.test.ts
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

## Slice W4 — web: connection-details handler and LiveKit token minting

**RED** — `test/server/connection-details.test.ts` written first: 12 cases

```
$ pnpm exec vitest --run test/server/connection-details.test.ts
Error: Failed to resolve import "@/lib/server/connection-details" from "test/server/connection-details.test.ts". Does the file exist?
 Test Files  1 failed (1)
      Tests  no tests
```

**GREEN** — `lib/server/livekit-token.ts`, `lib/server/connection-details.ts`; `ConfigResult` failure shape
gained `allowedOrigins` so the 503 is still same-origin only (env tests updated to match)

```
$ pnpm exec vitest --run test/server
 Test Files  1 failed | 3 passed (4)
      Tests  2 failed | 30 passed (32)
      # 1) global limiter was consulted before the per-client one → reordered so a noisy client cannot drain the shared budget
      # 2) jose: "payload must be an instance of Uint8Array" under jsdom (cross-realm Uint8Array) → server tests pinned to `@vitest-environment node`
$ pnpm exec vitest --run test/server
 Test Files  1 failed | 3 passed (4)
      Tests  1 failed | 31 passed (32)   # SDK stamps `nbf`, not `iat`; lifetime assertion now uses exp - nbf
$ pnpm exec vitest --run test/server
 Test Files  4 passed (4)
      Tests  32 passed (32)
```

Covered: 200 body shape, server-fixed agent name and TTL, 405 for non-POST, 403 for missing/`null`/
cross-origin/fetch-metadata mismatches, 503 with variable names only, allowlist enforced while
unconfigured, declared and streamed body bounds (413), 415/400 for non-JSON or non-object bodies,
client-supplied `agentName`/`roomName`/`identity`/`ttl`/`grants` rejected (400), per-client and global
429 with `Retry-After`, generic 500 on mint failure logging only the error class, and a real signed
token verified with `TokenVerifier` (grants, microphone-only publish, fixed dispatch, 600 s lifetime).

## Slice W5 — worker runtime and executable entrypoint

The Python worker now includes the LiveKit `AgentSession`, OpenAI Realtime model configuration,
data-channel command parsing, bounded action delegation, scoped approvals, cancellation, timeout,
verification-gated terminal states, and the executable `agent_voice_worker.main` CLI.

The entrypoint was developed RED/GREEN: `tests/test_main.py` first failed at collection because the
module did not exist, then passed after the CLI and `WorkerOptions` construction were implemented.

## Slice W6 — LiveKit transcript bridge

`tests/test_transcript_bridge.py` was written first and failed at collection because the forwarding
functions did not exist. The worker now subscribes before session start to
`user_input_transcribed` and `conversation_item_added`, publishing interim/final user transcript
events and final assistant message events through the versioned Agent Voice data topic.

```text
$ uv run pytest tests/test_transcript_bridge.py -q
....                                                                     [100%]
```

## Final unified release gate

Run from the repository root after all integrations and documentation corrections:

```text
$ pnpm check
TypeScript: 29 test files, 268 tests passed
Python:     189 tests passed
Ruff:       format and lint passed
mypy:       32 source files passed
Build:      Next.js production build passed; /icon.svg emitted
Secrets:    190 files scanned, no findings
Result:     check: all gates passed
```

Additional release checks performed outside the canonical gate:

- Docker Compose configuration parsed successfully.
- All three package tarballs excluded source/test files and imported successfully from an empty temporary consumer.
- The worker CLI failed closed without credentials and printed missing variable names only.
- Production browser QA passed at desktop and mobile widths with no horizontal overflow, keyboard Start activation, the expected fail-closed `503`, and no unexpected console errors.

Provider-backed verification remains deliberately separate: no real LiveKit room, microphone,
speaker, OpenAI Realtime request, or live Hermes bridge call was exercised without operator-owned
credentials and services.
