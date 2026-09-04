# Agent Voice

Agent Voice is an open-source-ready voice action layer for tool-using AI agents.
"Agent Voice" is a neutral working name for this repository and its packages —
the project has no fixed public product name yet.

A human speaks naturally in the browser. Agent Voice handles the full-duplex voice
transport, live two-sided transcription, and interruption/barge-in, and hands
anything that isn't ordinary conversation to a connected agent through a bounded,
versioned protocol. The agent reports progress, can request scoped approval before
a consequential action, and returns a result the voice layer either marks
**verified** or reports as a plain, honest failure.

**Agent Voice never claims an action succeeded unless the connected agent returned
a verified result.** That rule is enforced in code (`@agent-voice/protocol`,
`@agent-voice/adapter-sdk`) and in the realtime model's instructions, not just in
this document. The HTTP adapter validates the result envelope and consistency;
the operator remains responsible for trusting the connected agent's stated
verification method.

The realtime conversational model used by the reference implementation is a
detail of configuration (see [Configuration](#configuration)), not part of the
product's identity. Build-time implementation models are likewise not part of
the runtime contract or user-facing product.

## Compatibility matrix

Status reflects what has actually been exercised locally, recorded in
[`docs/verification.md`](docs/verification.md) — not aspiration.

| Component | Status | Notes |
| --- | --- | --- |
| Protocol (`@agent-voice/protocol`) | **Verified** | Schema, fixtures, and encode/parse round-trips covered by tests. |
| Adapter SDK (`@agent-voice/adapter-sdk`) | **Verified** | Action runner and approval broker covered by tests. |
| OpenAI-compatible HTTP adapter (`@agent-voice/adapter-openai-http`) | **Verified (unit level, mocked transport)** | Request/response shape, bounds, and failure mapping covered by tests. Not exercised against a live endpoint with real credentials. |
| Web app — configuration, origin checks, rate limiting, token minting | **Verified** | Server-side logic covered by tests; see `docs/verification.md`. |
| Web app — LiveKit voice session | **Verified locally** | A real token, room dispatch, Agent Voice participant, microphone transcripts, assistant replies, interruption handling, and an attached remote audio element were observed without browser errors. Audible device playback was not independently measured. |
| Worker (LiveKit Agents, Python) | **Verified locally with LiveKit Inference** | A real cloud job spawned on macOS; managed STT accepted microphone speech, the LLM produced replies, TTS published remote audio, and endpointing/interruption ran. OpenAI Realtime remains unverified. |
| **Hermes** (OpenAI-compatible endpoint) | **Reference target; live bridge not verified** | The generic adapter uses an OpenAI-compatible chat/completions shape. Tests use a mocked transport; this release did not call a running Hermes endpoint. |
| Claude Code, Codex, OpenClaw, or other agent CLIs | **Not implemented, not verified** | No adapter exists yet. Do not treat these as supported until an adapter ships with the same test coverage as `adapter-openai-http`. |

If a row above doesn't say "verified," treat it as a design, not a guarantee.

## Architecture

```text
apps/
  web/                 Next.js voice + transcript UI, server-only token route
  worker/              Python LiveKit Agents realtime/action worker
packages/
  protocol/            Versioned event/command schemas, limits, fixtures
  adapter-sdk/         Provider-neutral agent adapter contract + action runner
  adapter-openai-http/ Generic OpenAI-compatible HTTP adapter
examples/
  hermes-local/        Placeholder configuration for a local Hermes-style endpoint
  openai-compatible/   Placeholder configuration for any OpenAI-compatible endpoint
docs/                  Architecture, protocol, adapter authoring, security, ProductOS boundary
scripts/               setup / dev / check / check-env / secret-scan
```

See [`docs/architecture.md`](docs/architecture.md) for the request/event flow and
[`docs/protocol-events.md`](docs/protocol-events.md) for the wire contract.

## Quick start

Requirements: Node.js 22.22.2+, 24.15+, or 26+, pnpm ≥ 9, Python 3.12 with
[uv](https://docs.astral.sh/uv/) (worker only), and a LiveKit server (self-hosted
or cloud). The default OpenAI Realtime provider also needs an OpenAI API key;
LiveKit Inference uses the LiveKit credentials for managed STT → LLM → TTS.
The recorded live verification uses `AGENT_VOICE_REALTIME_PROVIDER=livekit-inference`;
the default `openai-realtime` path has not been exercised end-to-end in this release.

```bash
pnpm setup      # installs the workspace, creates .env from .env.example
pnpm check      # runs the full quality gate — needs no credentials
pnpm dev        # starts the web app; starts the worker only if it is configured
```

Without any credentials configured, the web app still starts, serves an honest
"configuration required" state, and its health endpoint reports `configured:
false`. The token route returns `503` listing only the names of missing
variables — never values. See [Local development](#local-development) for what
each piece needs to actually run.

## Configuration

Agent Voice is configured entirely through environment variables. Copy
[`.env.example`](.env.example) to `.env` and fill in values — **names only are
documented here and printed by any tooling; values are never logged, returned in
errors, or committed.**

| Variable | Used by | Purpose |
| --- | --- | --- |
| `LIVEKIT_URL` | web, worker | LiveKit server WebSocket URL |
| `LIVEKIT_API_KEY` | web, worker | LiveKit API key (server-side only) |
| `LIVEKIT_API_SECRET` | web, worker | LiveKit API secret (server-side only) |
| `AGENT_VOICE_REALTIME_PROVIDER` | worker | `openai-realtime` (default) or `livekit-inference` |
| `OPENAI_API_KEY` | worker | Required only for `openai-realtime` |
| `AGENT_VOICE_REALTIME_MODEL` | worker | Realtime model id, must match the worker's server-side allowlist |
| `AGENT_VOICE_REALTIME_VOICE` | worker | Realtime voice id |
| `AGENT_VOICE_ADAPTER` | worker | Delegate adapter selection (`openai-http` or `none`) |
| `AGENT_VOICE_AGENT_ENDPOINT` | worker | Base URL of the delegated agent's OpenAI-compatible API |
| `AGENT_VOICE_AGENT_API_KEY` | worker | Optional bearer key for the delegated agent endpoint |
| `AGENT_VOICE_AGENT_MODEL` | worker | Model id passed to the delegated agent endpoint |
| `AGENT_VOICE_SESSION_KEY` | worker | Stable, opaque key so the delegated agent can keep memory across turns |
| `AGENT_VOICE_AGENT_TIMEOUT_SECONDS` | worker | Per-delegation timeout, bounded 1–120 seconds |
| `AGENT_VOICE_AGENT_NAME` | web, worker | Fixed worker name used for explicit LiveKit dispatch (must match on both sides) |
| `AGENT_VOICE_ALLOWED_ORIGINS` | web | Exact origins allowed to call the token route (comma-separated) |
| `AGENT_VOICE_TOKEN_TTL_SECONDS` | web | Participant token lifetime, bounded 60–900 seconds |

No secret reaches browser JavaScript, token responses, logs, fixtures, or these
docs. `node scripts/check-env.mjs` reports which variables are present or
missing by name, for either component or both, without ever reading a value
into its output.

## Local development

```bash
pnpm setup            # one-time: install JS + Python environments, create .env
pnpm check            # format, lint, typecheck, test, build — offline, no credentials
pnpm dev              # web + worker together (worker only if configured)
pnpm dev:web          # web app only
pnpm dev:worker       # worker only (needs full worker configuration)
node scripts/check-env.mjs --component worker --strict
```

The web app runs and is testable without credentials. The connected path requires
real LiveKit credentials plus either OpenAI Realtime credentials or LiveKit
Inference access. Real room dispatch, microphone transcription, model replies, and
remote audio publication have been exercised. Audible device playback and a
delegated action remain outside the recorded verification boundary; see the
compatibility matrix above.

For containerized development, see [`docker-compose.yml`](docker-compose.yml). It
builds the web and worker images from the Dockerfiles in this repository and
reads all configuration from environment variables — it does not embed or
generate any secret.

## Approvals and verification principles

- **An action is verified only when the adapter that ran it returned a verified
  result.** The voice layer has no other way to mark something as done.
- **Approvals are scoped, not blanket.** Each `approval.requested` event is bound
  to one action ID and has an explicit expiry; there is no command that grants
  standing or future permission.
- **Failures are spoken honestly and safely.** Raw exception messages, stack
  traces, and provider transport detail never reach the user, transcript, or
  logs. Transport/parser failures use generic summaries; a trusted delegated
  agent's structured non-verified result may provide its own bounded user-facing
  summary and failure status.
- **Agent-supplied content is untrusted data.** Text is bounded and rendered as
  text; artifact URLs are validated to be absolute `http(s)` links without
  embedded credentials before the UI will render them at all.
- **The protocol is versioned and closed.** Every event and command is validated
  against a strict schema (unknown fields rejected) with hard size bounds; unknown
  future event *types* are ignored rather than crashing the session.

See [`docs/protocol-events.md`](docs/protocol-events.md) for the full event and
command catalogue, and [`SECURITY.md`](SECURITY.md) for the complete threat model
and the controls that enforce these principles.

## Security warnings

- **This is pre-1.0 software.** Only `main` receives security fixes.
- **There is no user authentication.** The same-origin check on the token route
  stops other sites from minting tokens through a visitor's browser, but anyone
  who can load the page can start a session. Put the app behind your own
  authentication before exposing it beyond localhost.
- **Never commit `.env` or any file containing a real credential.** Only
  `.env.example` files with empty values belong in this repository.
- **The in-memory rate limiter is per-process.** Behind multiple replicas it
  limits per replica; add a shared limiter or gateway in front for multi-instance
  deployments.
- **The delegated agent endpoint receives the user's request text.** Only point
  `AGENT_VOICE_AGENT_ENDPOINT` at an endpoint you trust with that data.

Read [`SECURITY.md`](SECURITY.md) for the full threat model, and
[`docs/security.md`](docs/security.md) for deployment-time hardening notes
(containers, networking, reverse proxies).

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — components, request flow, data-channel transport
- [`docs/protocol-events.md`](docs/protocol-events.md) — the full versioned event/command contract
- [`docs/adapter-authoring.md`](docs/adapter-authoring.md) — how to write a new agent adapter
- [`docs/security.md`](docs/security.md) — deployment hardening, container and network boundaries
- [`docs/productos-integration.md`](docs/productos-integration.md) — the public/private boundary for downstream integrators
- [`docs/verification.md`](docs/verification.md) — the real RED/GREEN test history behind the status table above
- [`SECURITY.md`](SECURITY.md) — vulnerability reporting and the full threat model
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — workflow, TDD requirement, style

## Acknowledgements

The web console's animated agent orb is rendered by
[`thinking-orbs`](https://github.com/Jakubantalik/thinking-orbs) by Jakub
Antalik, used under the MIT License. The rest of the interface — layout,
status vocabulary, and the mapping from session status to orb animation — is
this project's own.

## License

[Apache License 2.0](LICENSE).
