# ProductOS integration boundary

Agent Voice is a standalone, open-source-ready project. It has no dependency on
ProductOS, and this repository contains no ProductOS-specific behavior, brand
names, internal agent names, private endpoints, or credentials. This document
exists so that a downstream integrator — ProductOS or anyone else — knows
exactly where the public boundary is and what stays private on their side.

## What this repository owns (public)

- Full-duplex voice transport, interruption/barge-in, live two-sided
  transcription, and voice/text continuity in the browser UI.
- Session and connection state, including the token-minting service and its
  security controls.
- The versioned event/command protocol (`@agent-voice/protocol`) —
  conversation lifecycle, transcripts, action/progress/approval/result events,
  cancellation.
- The provider-neutral adapter contract (`@agent-voice/adapter-sdk`) and one
  reference implementation (`@agent-voice/adapter-openai-http`).
- Deployment scaffolding: Dockerfiles, Compose file, environment contract,
  scripts.

None of this needs to know what kind of agent it is ultimately talking to, what
that agent is named internally, or what private tools it has access to. That is
exactly the point of the adapter boundary.

## What stays private, downstream

Anything specific to a particular deployment's internal agents, orchestration,
tool access, or business logic belongs in a private adapter implementation that
consumes this repository's published packages — it does not belong in this
repository. Concretely, a downstream integrator implements:

- An `AgentAdapter` (TypeScript) or the worker-side equivalent that calls
  whatever internal agent runtime it needs to, over whatever transport and
  authentication that runtime requires.
- Any mapping from that internal agent's own tool/action model onto this
  project's `AdapterResult` (`status`, `summary`, `verification`, `artifacts`).
- Its own configuration, secrets, and network access for reaching that internal
  runtime — none of it flows through this repository's `.env.example` or
  scripts.
- Its own product naming, branding, and UI customization layered on top of, or
  instead of, the reference web app.

## How to consume this project without leaking internals here

- Depend on the published packages (`@agent-voice/protocol`,
  `@agent-voice/adapter-sdk`) as versioned dependencies; do not fork protocol
  types into a private copy that can drift.
- Keep private adapter code, private agent names, private endpoints, and any
  credentials entirely in your own private repository or deployment
  configuration.
- If you need a new protocol event or command that your private adapter
  requires, propose it here in terms of what it represents generically (e.g.
  "an action can report an intermediate approval-like checkpoint") — not in
  terms of your internal agent's specific tools or names. See
  [adapter-authoring.md](adapter-authoring.md) and `CONTRIBUTING.md` for the
  process.
- Do not submit changes to this repository that hardcode a specific
  downstream product's identity, internal agent names, or private endpoints —
  those belong in the consuming deployment, not here.

## What this document does not cover

This document intentionally contains no information about any specific private
deployment, internal agent, or ProductOS-internal architecture. If you are
integrating this project with a private system, consult that system's own
(non-public) documentation for its side of the boundary.
