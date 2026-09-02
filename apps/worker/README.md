# Agent Voice worker

The worker is the server-side LiveKit Agents runtime for Agent Voice. It owns the realtime conversation session, forwards transcripts into the public protocol, and delegates tool-requiring requests to the configured action agent.

It is not a second agent brain. Memory, tools, permissions, approval policy, execution, and verification remain with the connected action agent.

## Implemented behavior

- Starts either an OpenAI Realtime session or a LiveKit Inference STT → LLM → TTS session.
- Publishes versioned events on `agent-voice.events.v1`.
- Accepts bounded commands on `agent-voice.commands.v1`.
- Forwards interim and final user transcripts.
- Forwards final assistant messages.
- Delegates action requests through the `none` or `openai-http` adapter.
- Emits progress, scoped approval, artifact, verification, failure, and cancellation lifecycle events.
- Rejects malformed, oversized, cross-conversation, stale, or mismatched commands.
- Applies a bounded action timeout and deny-dominant approval semantics.
- Redacts provider details from public failures.

## Requirements

- Python 3.12
- `uv`
- A LiveKit server
- An OpenAI API key only when `AGENT_VOICE_REALTIME_PROVIDER=openai-realtime`
- A trusted OpenAI-compatible action-agent endpoint when `AGENT_VOICE_ADAPTER=openai-http`

## Configuration

The worker reads configuration from environment variables. Values stay server-side and must never be committed.

Required for the realtime worker:

- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `OPENAI_API_KEY` when using `openai-realtime`
- `AGENT_VOICE_AGENT_ENDPOINT` when using `openai-http`

Important optional settings:

- `AGENT_VOICE_REALTIME_PROVIDER` (`openai-realtime` or `livekit-inference`)
- `AGENT_VOICE_REALTIME_MODEL`
- `AGENT_VOICE_REALTIME_VOICE`
- `AGENT_VOICE_ADAPTER` (`openai-http` or `none`)
- `AGENT_VOICE_AGENT_API_KEY`
- `AGENT_VOICE_AGENT_MODEL`
- `AGENT_VOICE_SESSION_KEY`
- `AGENT_VOICE_AGENT_TIMEOUT_SECONDS`
- `AGENT_VOICE_AGENT_NAME`

See the root [`.env.example`](../../.env.example) for the full contract.
The shipped LiveKit Inference pipeline is English-only and uses managed Deepgram
STT, OpenAI-compatible LLM inference, and xAI TTS. The default OpenAI Realtime
path remains available but was not exercised end-to-end in this release.

## Run

From the repository root:

```bash
pnpm setup
bash scripts/worker.sh check-env
pnpm dev:worker
```

Or from this directory:

```bash
uv sync --frozen
uv run python -m agent_voice_worker.main dev
```

The `check-env` command reports missing variable names only. It never prints values.

## Verify locally

```bash
uv run pytest -q
uv run ruff format --check src tests
uv run ruff check src tests
uv run mypy src tests
```

The root `pnpm check` runs these worker checks together with the TypeScript packages, web app, production build, and repository secret scan.

## Verification boundary

The worker runtime, CLI, transcript bridge, protocol parsing, action lifecycle, approvals, cancellation, timeout, and failure redaction are locally tested.

A real LiveKit room dispatch, microphone transcription, LiveKit Inference model reply, remote audio publication, endpointing, and interruption have been exercised with operator-owned services. Audible device playback, an OpenAI Realtime call, and a delegated Hermes action remain unverified.
