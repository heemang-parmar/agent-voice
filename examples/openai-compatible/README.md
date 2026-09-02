# Example: generic OpenAI-compatible endpoint

This example configures `@agent-voice/adapter-openai-http` against any remote
or self-hosted endpoint that speaks the standard OpenAI chat/completions HTTP
shape — not specific to any one provider. It is a **configuration example
only**: no code, no bundled server, no real credentials.

## When to use this instead of `examples/hermes-local`

Use this example if your delegated agent endpoint is not running on your local
machine, or you simply want a generic template. The adapter itself doesn't
care which OpenAI-compatible server is on the other end — the difference
between this example and `examples/hermes-local` is entirely in the values you
put in `AGENT_VOICE_AGENT_ENDPOINT` and `AGENT_VOICE_AGENT_MODEL`.

## Configuration

```bash
AGENT_VOICE_ADAPTER=openai-http
AGENT_VOICE_AGENT_ENDPOINT=https://your-agent-endpoint.example.com/v1
AGENT_VOICE_AGENT_API_KEY=
AGENT_VOICE_AGENT_MODEL=your-model-id
AGENT_VOICE_SESSION_KEY=agent-voice-openai-compatible
AGENT_VOICE_AGENT_TIMEOUT_SECONDS=60
```

- `AGENT_VOICE_AGENT_ENDPOINT` must be an absolute `http(s)` URL; the adapter
  rejects anything else at construction.
- `AGENT_VOICE_AGENT_API_KEY` is sent as a bearer token if set. It is never
  logged, never echoed in an error, and never reaches the browser — it lives
  only in the worker's server-side environment. Leave it blank for an endpoint
  that doesn't require authentication (for example, a local development
  server), but never commit a real key into this file.
- `AGENT_VOICE_AGENT_TIMEOUT_SECONDS` bounds how long the worker waits for a
  response (1–120 seconds); the adapter also caps request and response body
  sizes independent of this timeout (see `docs/adapter-authoring.md`).

The endpoint must return strict result JSON in
`choices[0].message.content`, for example:

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

Plain assistant prose and truncated completions are rejected rather than
promoted to verified action results.

This JSON is the trusted delegated agent's attestation. The adapter validates
its shape and consistency but does not independently repeat the tool check.
Only point the adapter at an endpoint you trust to execute and verify actions.
Do not wrap the JSON in a Markdown fence, and omit optional `detail` instead of
setting it to `null`.

## Turning off delegation entirely

Set `AGENT_VOICE_ADAPTER=none` to run the realtime voice path without any
delegated agent — useful for testing the conversational layer in isolation.
The `delegate_to_agent` tool becomes unavailable and every request that would
need it is refused honestly rather than answered by the voice model alone.

## What is and isn't verified

See the compatibility matrix in the root [`README.md`](../../README.md). The
adapter's request/response handling and failure-mode mapping are covered by
unit tests against a mocked transport; running it against your own live
endpoint through a full voice session has not been exercised in this
repository's own test history.
