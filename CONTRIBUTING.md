# Contributing

Thanks for helping build Agent Voice. This document covers the local workflow, the
quality gate every change must pass, and the rules that keep the project safe to run.

## Prerequisites

- Node.js 22.22.2+, 24.15+, or 26+ and pnpm ≥ 9
- Python 3.12 and [uv](https://docs.astral.sh/uv/) (for the worker)
- Git

## Local setup

```bash
pnpm setup      # installs the JS workspace and the Python worker, creates .env from .env.example
pnpm check      # runs every gate; needs no credentials
```

Everything under `pnpm check` runs offline. The voice path itself (browser mic → LiveKit →
worker → configured realtime provider → delegated agent) needs real credentials in `.env`;
see the README.

## Workflow

1. Branch from `main`.
2. Write the test first. This repository is built with vertical-slice TDD: a failing test
   (RED) for the smallest useful behaviour, then the implementation (GREEN), then cleanup.
   `docs/verification.md` records the real RED/GREEN cycles so far; append to it for
   substantial slices — never rewrite history there, and never paste tokens or request bodies.
3. Run `pnpm check` until it is green. It runs, in order:
   `format:check`, `lint`, `typecheck`, `test`, `build`, `check:worker`, `check:secrets`.
4. Open a pull request that says what was verified locally and what was not.

## Ground rules

- **No secrets, ever.** No API keys, tokens, certificates, `.env` files, private
  endpoints, or personal paths in code, tests, fixtures, docs or commit messages.
  `pnpm check:secrets` scans for common shapes; treat a hit as a blocker, not a false positive
  to be excluded.
- **Never print credential values.** Logging the *name* of a missing variable is fine;
  logging its value is not. Error responses list missing names only.
- **Never claim success the system did not verify.** The voice model may only report an
  action as done when the adapter returned a `verified` result. Failures are reported plainly
  and generically; raw upstream error text does not reach the user or the logs.
- **Bounded everything.** Payload sizes, text lengths, timeouts, rate limits and list
  lengths have hard caps in `@agent-voice/protocol`. New wire fields need a bound and a fixture.
- **Protocol changes** require: a schema change in `packages/protocol/src`, matching JSON
  fixtures under `packages/protocol/fixtures`, `pnpm --filter @agent-voice/protocol generate:fixtures`,
  and the Python conformance test in `apps/worker/tests` passing against the same fixtures.
- **Adapters** implement `AgentAdapter` from `@agent-voice/adapter-sdk` (TypeScript) or the
  worker's `DelegateClient` contract (Python). Document an adapter as *planned* until its
  end-to-end path has been exercised; the README keeps the authoritative status table.

## Style

- TypeScript: strict mode, `exactOptionalPropertyTypes`, no `any`, Prettier formatting,
  `eslint` with type-aware rules. Prefer small pure functions and reducers over stateful classes
  in the UI.
- Python: `ruff format`, `ruff check`, `mypy --strict`. Async code must be cancellation-safe.
- Keep comments for *why*, not *what*.

## Reporting a vulnerability

See [SECURITY.md](SECURITY.md). Do not open a public issue for security problems.
