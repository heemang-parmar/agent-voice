# Agent Voice — web app image.
#
# This is a pnpm workspace: apps/web depends on the workspace packages under
# packages/*. Build with the repository root as context, e.g. from the repo
# root:
#
#   docker build -f apps/web/Dockerfile -t agent-voice-web .
#
# No secret is ever baked into this image. All configuration (LIVEKIT_*,
# AGENT_VOICE_*) is read from the environment at container runtime — see
# .env.example at the repository root and docker-compose.yml.

FROM node:20-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ---------------------------------------------------------------------------
FROM base AS deps
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/adapter-sdk/package.json packages/adapter-sdk/package.json
COPY packages/adapter-openai-http/package.json packages/adapter-openai-http/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
FROM base AS build
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /pnpm /pnpm
COPY . .
RUN pnpm --filter './packages/*' build
RUN pnpm --filter @agent-voice/web build

# ---------------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /repo

RUN groupadd --system agentvoice && useradd --system --gid agentvoice --home-dir /repo agentvoice

COPY --from=build /repo/pnpm-workspace.yaml /repo/pnpm-lock.yaml /repo/package.json ./
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/apps/web ./apps/web
COPY --from=build /repo/node_modules ./node_modules

USER agentvoice

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Configuration is validated at request time (see lib/server/env.ts); a
# missing variable surfaces as an honest "not configured" response, by name
# only, never as a crash on startup.
CMD ["pnpm", "--filter", "@agent-voice/web", "exec", "next", "start", "-p", "3000", "-H", "0.0.0.0"]
