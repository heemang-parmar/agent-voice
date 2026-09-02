# Example: local Hermes-style endpoint

This example shows how to point the worker's `openai-http` adapter at a
Hermes-style OpenAI-compatible endpoint running on your own machine. It is a
**configuration example only** — it contains no code, no real credentials, and
no bundled Hermes binary. You still need a working LiveKit deployment and your
own realtime provider key to exercise the full voice path; see the root
[`README.md`](../../README.md) compatibility matrix for exactly what has and
hasn't been verified end-to-end.

## What "Hermes-compatible" means here

`@agent-voice/adapter-openai-http` speaks the standard OpenAI chat/completions
HTTP shape: `POST {endpoint}/chat/completions` with a bearer key, a model id,
and `stream: false`. The text reconstructed from `choices[0].message.content`
must be a strict JSON result containing `status`, `summary`, and
`verification`; plain completion prose is rejected because it is not a valid
verification attestation. Anything that exposes that request shape and result
contract locally — including a suitably prompted local Hermes instance — can
be connected to this adapter. This repository does not install, run, or manage
Hermes itself.

The adapter validates the returned structure and consistency; it does not
independently repeat the endpoint's tool check. Configure only an agent endpoint
you trust to execute actions and report its verification method honestly.

## Configuration

Copy [`.env.example`](.env.example) in this directory into the relevant
sections of your root `.env` (or copy the whole repo's `.env.example` and edit
the values below). Every value shown here is a placeholder — fill in your own
locally-run endpoint, never a value that should stay secret.

```bash
AGENT_VOICE_ADAPTER=openai-http
AGENT_VOICE_AGENT_ENDPOINT=http://127.0.0.1:8642/v1
AGENT_VOICE_AGENT_API_KEY=
AGENT_VOICE_AGENT_MODEL=hermes-local
AGENT_VOICE_SESSION_KEY=agent-voice-hermes-local
AGENT_VOICE_AGENT_TIMEOUT_SECONDS=60
```

- `AGENT_VOICE_AGENT_ENDPOINT` must be the base URL of your local endpoint,
  including the `/v1` (or equivalent) prefix your server expects.
- `AGENT_VOICE_AGENT_API_KEY` is optional — leave it blank if your local
  endpoint doesn't require one. Never commit a real key here or anywhere else;
  only `.env` (git-ignored) should ever hold one.
- `AGENT_VOICE_AGENT_MODEL` should match whatever model identifier your local
  endpoint expects in the request body.

## Running it

1. Start your Hermes-style endpoint locally however it's normally run (outside
   the scope of this repository).
2. Fill in the values above in your root `.env` (copied from the repository's
   `.env.example`, which also needs the `LIVEKIT_*` and `OPENAI_API_KEY`
   variables for the realtime path).
3. Run `pnpm dev` from the repository root, or `pnpm dev:worker` to start only
   the implemented worker.

## What is and isn't verified

The request/response shape this adapter sends and expects is covered by unit
tests with a mocked transport (`packages/adapter-openai-http/test`). Running it
against a real local Hermes-style server, end to end, through a live voice
session, has not been exercised in this repository's own test history — treat
that combination as "designed for" rather than "verified" until you've run it
yourself.
