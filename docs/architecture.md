# Architecture

Agent Voice separates four concerns cleanly: the versioned wire contract, the
provider-neutral adapter interface, the realtime voice worker, and the browser
UI. Nothing above the protocol layer needs to know which agent is on the other
end of a delegated action.

## Components

```text
Browser (apps/web)
  ├─ Start session → POST /api/connection-details (server-only, same-origin only)
  ├─ LiveKit room connection (mic in, remote audio out)
  └─ Renders events from the LiveKit data channel; sends commands back on it

Web server (apps/web, Node runtime)
  ├─ lib/server/env.ts             configuration by NAME only, never logs values
  ├─ lib/server/origin.ts          exact-match same-origin + Fetch Metadata check
  ├─ lib/server/rate-limit.ts      bounded sliding-window limiter
  ├─ lib/server/livekit-token.ts   short-lived token minting, fixed grants
  └─ lib/server/connection-details.ts  ties the above together for the route

Worker (apps/worker, Python, LiveKit Agents)
  ├─ realtime session with the configured conversational model
  ├─ interim/final user transcript + final assistant message events
  ├─ delegate_to_agent tool → an AgentAdapter implementation
  └─ emits protocol events / accepts protocol commands over the data channel

packages/protocol      the versioned event/command schemas both sides parse
packages/adapter-sdk   AgentAdapter contract + action runner + approval broker
packages/adapter-openai-http   the one implemented adapter (OpenAI-compatible HTTP)
```

## Request flow

1. The browser requests the microphone only after an explicit **Start** action —
   never on page load.
2. The browser calls the connection-details route. The server validates method,
   exact-origin, and body size, applies rate limits, and — only if everything
   checks out — mints a short-lived LiveKit participant token with fixed grants
   and dispatches the fixed worker name. Nothing in the request can choose the
   room, identity, TTL, grants, or dispatched agent.
3. The browser joins the LiveKit room with that token. The worker joins the same
   room as the dispatched agent identity and publishes protocol events.
4. The realtime conversational model handles ordinary conversational turns
   directly. When the user's request needs memory, current facts, computation,
   file/system access, coding, scheduling, or any other real-world action, the
   model calls a bounded `delegate_to_agent` tool.
5. That tool call goes through `@agent-voice/adapter-sdk`'s action runner, which
   wraps a concrete `AgentAdapter` (see
   [adapter-authoring.md](adapter-authoring.md)) with a deadline, a cancellation
   signal, and an approval broker.
6. The adapter emits `action.progress` and `artifact.created` events as it works,
   may issue an `approval.requested` event bound to the exact action, and finally
   resolves to a result the runner turns into either `action.verified` or
   `action.failed`.
7. Events travel to the browser over a LiveKit data-channel topic
   (`agent-voice.events.v1`); commands (approval answers, cancellation) travel
   back over `agent-voice.commands.v1`. Both are validated against the same
   schemas in `@agent-voice/protocol` on both ends.
8. The voice model only ever reports an action as done when it received a
   `verified` result from the adapter. It cannot report success from its own
   guess.

## Why this separation

- **Protocol as the seam.** The browser and the worker never share code beyond
  `@agent-voice/protocol`. A new UI or a new worker implementation only needs to
  agree on the schemas and topics, not on internals.
- **Adapters are swappable.** `AgentAdapter` (TypeScript, `@agent-voice/adapter-sdk`)
  and the worker's equivalent Python contract are the only surface a new agent
  integration has to implement. `adapter-openai-http` is the reference
  implementation and the only one with test coverage today.
- **The web server is a narrow, hardened gate.** It never talks to the realtime
  model or the delegated agent directly — its only job is minting a scoped,
  short-lived LiveKit token under strict origin and rate-limit controls. See
  [`SECURITY.md`](../SECURITY.md) for the full control list.
- **Verification is structural, not aspirational.** `AdapterResult.verification`
  is enforced by the action runner: a `verified` status without a matching
  verification state is a bug, not a policy the model has to remember.

## Data-channel transport

Events and commands are JSON-encoded, versioned (`v: 1`), and bounded to 12 KiB
per message (`packages/protocol/src/limits.ts`). Every event and command carries
`id`, `ts` (ISO-8601 with an explicit offset), and `conversationId`. Unknown
extra fields are rejected (`.strict()` schemas); unrecognized event *type*
strings are ignored by consumers rather than treated as fatal, so the wire
contract can grow without breaking older clients. See
[protocol-events.md](protocol-events.md) for the full catalogue.
