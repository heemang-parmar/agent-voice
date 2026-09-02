# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Report them privately to the
maintainers (open a private security advisory on the repository host if that feature is
available, or contact a maintainer directly). Include steps to reproduce, the affected
component (`apps/web`, `apps/worker`, `packages/*`) and, if you have one, a suggested fix.
You will get an acknowledgement, and a fix or mitigation plan before any public disclosure.

## Threat model (what this project defends against)

Agent Voice sits between a browser, a LiveKit server, an OpenAI Realtime session and a
tool-using agent that can perform real work. The main risks are:

1. **Credential exposure.** LiveKit and OpenAI keys, and the delegated agent's endpoint and
   key, must only exist on the server side.
2. **Unauthorised token minting.** The token route could be abused to obtain LiveKit access.
3. **Client-controlled dispatch.** A client that could choose the room, identity, grants,
   TTL, agent name, model or endpoint could impersonate users or redirect the agent.
4. **Unverified claims.** A voice model saying "done" when nothing was done.
5. **Oversized or malformed messages** on the data channel, from either side.
6. **Leaking upstream detail** (stack traces, error bodies, keys) into speech, UI or logs.

## Controls in place

| Area | Control |
| --- | --- |
| Token route | Node runtime, `POST` only (`405` + `Allow: POST` otherwise), exact-match same-origin `Origin` allowlist, `Sec-Fetch-Site` cross-check, CORS closed (no `Access-Control-Allow-*` headers ever), request body capped at 1 KiB and must be empty or `{}`, per-client fixed-window rate limit, `Cache-Control: no-store` + `Vary: Origin` on every response, generic error bodies. |
| Token contents | Room and identity are crypto-random and server-generated; TTL is fixed server-side (default 600 s, bounded 60–900 s); grants are exactly `roomJoin`, `canPublish`, `canSubscribe`, `canPublishData` with `canUpdateOwnMetadata=false`; the dispatched agent name is a server-side constant. Nothing in the request can influence any of this. |
| Configuration | Required variables are validated at startup and per request. Missing variables are reported by **name only** (`503 not_configured`, `/api/ready`, `scripts/check-env.mjs`, worker `check-env`). Secret values are wrapped in a `Secret` type in the worker whose `repr`/`str` is redacted. |
| Protocol | Every event and command is validated with strict schemas (unknown keys rejected), bounded to 12 KiB, and carries only opaque bounded identifiers. Artifact URLs must be absolute `http(s)` without embedded credentials; `javascript:`, `data:`, `blob:` and relative URLs are rejected at the protocol boundary. |
| Approvals | Each approval is bound to one `actionId` + `approvalId` and expires. Late, duplicate or mismatched answers are ignored. There is no "approve everything" command. |
| Delegation | The worker calls the agent endpoint server-side only, with bounded request (64 KiB) and response (256 KiB) sizes and a bounded timeout. HTTP and transport failures map to generic failure codes; only the exception class name is logged. |
| Verification | An action is `verified` only when the adapter actually received a result. The voice model's instructions forbid claiming success without a verified tool result, and the tool's return string states failures explicitly. |
| Browser | Microphone is requested only after an explicit **Start**. Remote audio is attached through the LiveKit renderer; autoplay failures surface an explicit **Enable audio** control instead of failing silently. |
| Repository | `.env*` (except `.env.example`), key material and generated directories are ignored. `pnpm check:secrets` scans tracked and untracked files for credential-shaped strings, private keys, private endpoints and personal paths. |

## Known limitations

- The rate limiter is in-memory and per-process. Behind multiple replicas it limits per
  replica; put a shared limiter or a gateway in front for multi-instance deployments.
- The token route trusts `X-Forwarded-For` / `X-Real-IP` for the client key when present.
  Only expose it behind a proxy that sets those headers itself.
- There is no user authentication. The same-origin check stops other sites from minting
  tokens through a visitor's browser, but anyone who can load the page can start a session.
  Put the app behind your own authentication before exposing it beyond localhost.
- The Content-Security-Policy shipped is intentionally conservative (`frame-ancestors`,
  `object-src`, `base-uri`, `form-action`); a full script/connect policy with nonces is left
  to deployments because the LiveKit URL is environment-specific.

## Supported versions

Only the `main` branch receives security fixes while the project is pre-1.0.
