# Security: deployment hardening

This document covers container and network boundaries when you run Agent Voice
somewhere other than a developer's laptop. It assumes you have already read
[`SECURITY.md`](../SECURITY.md), which is the authoritative threat model and
control list — this page does not repeat it, only extends it to deployment.

## Reporting a vulnerability

See [`SECURITY.md`](../SECURITY.md). Do not open a public issue.

## Trust boundaries

```text
Browser (untrusted)
   │  same-origin only, no credentials, mic only after explicit Start
   ▼
apps/web (Node runtime, server-only secrets: LiveKit key/secret)
   │  mints short-lived, narrowly-scoped LiveKit tokens only
   ▼
LiveKit server (your infrastructure or a managed provider)
   │
   ▼
apps/worker (server-only secrets: OpenAI key, delegated agent key)
   │  bounded request/response, timeout, no shell execution
   ▼
Delegated agent endpoint (e.g. Hermes) — receives the user's request text
```

Nothing left of the web server, and nothing left of the worker, should ever see
a LiveKit key, an OpenAI key, or a delegated-agent bearer key. Treat the
delegated agent endpoint itself as receiving sensitive data (the user's raw
request text) even though it is not a secret holder.

## Containers

- **Never bake secrets into an image.** The Dockerfiles in this repository
  accept configuration only through environment variables at container
  *runtime*; there is no `ARG`/`ENV` in either Dockerfile that sets a real
  value, and `.dockerignore` excludes `.env*` (except `.env.example`) from the
  build context entirely so a stray `.env` can't be copied in by an
  unqualified `COPY .`.
- **Run as a non-root user in production.** Both Dockerfiles create and switch
  to an unprivileged user for the final runtime stage.
- **Keep the images minimal.** Multi-stage builds discard build-only
  dependencies (dev/test tooling, compilers) from the final image.
- **`docker-compose.yml` is a development convenience, not a production
  manifest.** It reads secrets from your shell environment or an `.env` file
  you keep out of git (via `env_file:` / variable interpolation) and never
  embeds a value directly. For production, prefer your platform's secret
  manager over any `.env` file reaching a host at all.

## Networking

- Terminate TLS in front of `apps/web`; it does not do so itself.
- If you run the web app behind a reverse proxy or load balancer, only trust
  `X-Forwarded-For` / `X-Real-IP` from a proxy you control — the rate limiter
  keys on these headers when present (see `SECURITY.md`, Known limitations).
- Keep `AGENT_VOICE_ALLOWED_ORIGINS` an exact list of the origins that actually
  serve the web app. A wildcard or overly broad entry defeats the same-origin
  control on the token route.
- The worker only needs outbound access to LiveKit, your realtime provider, and
  your delegated agent endpoint. It does not need to accept inbound
  connections; don't expose it as a network service beyond what LiveKit's SDK
  requires.
- There is no built-in user authentication anywhere in this stack (see
  `SECURITY.md`). If you expose the web app beyond localhost, put your own
  authentication in front of it — a reverse proxy with SSO, a VPN, or an
  application-level auth layer.

## Secrets in CI/CD

- Never print an environment variable's value in a build log. Use
  `node scripts/check-env.mjs` (names only) to verify configuration in CI
  without ever handling a real value in this repository's own tooling.
- Run `pnpm run check:secrets` (`scripts/secret-scan.sh`) in CI on every change,
  the same way it runs locally, and treat a hit as a blocker.

## Before you deploy

- Confirm `.env` (or your secret manager's equivalent) is not readable by the
  container image, only injected at runtime.
- Confirm the web app's health endpoint reports `configured: true` only after
  you've verified LiveKit connectivity yourself — it reflects configuration
  presence and shape, not that credentials are valid or that the worker is
  reachable.
- Re-read the compatibility matrix in the root `README.md`. Do not represent
  the full voice path (microphone → LiveKit → worker → realtime model →
  delegated agent) as verified in your own deployment until you have exercised
  it yourself with real credentials — this repository's test history does not
  cover that path end-to-end.
