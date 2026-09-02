# Agent Voice — worker image.
#
# Build from the repository root so uv.lock and the worker source are both in
# context:
#
#   docker build -f apps/worker/Dockerfile -t agent-voice-worker .
#
# The runtime starts through `agent_voice_worker.main`. Provider-backed voice
# still requires operator-owned LiveKit and realtime-model credentials; see
# apps/worker/README.md and the compatibility matrix in the root README.
#
# No secret is ever baked into this image. All configuration (LIVEKIT_*,
# OPENAI_API_KEY, AGENT_VOICE_*) is read from the environment at container
# runtime — see .env.example at the repository root and docker-compose.yml.

FROM python:3.12-slim AS base
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# ---------------------------------------------------------------------------
FROM base AS build
WORKDIR /app
COPY apps/worker/pyproject.toml apps/worker/uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev
COPY apps/worker/src ./src
COPY apps/worker/README.md ./README.md
RUN uv sync --frozen --no-dev

# ---------------------------------------------------------------------------
FROM base AS runtime
RUN groupadd --system agentvoice && useradd --system --gid agentvoice --home-dir /app agentvoice
WORKDIR /app
COPY --from=build /app /app
ENV PATH="/app/.venv/bin:$PATH"
USER agentvoice

# Fails fast with the missing variable NAMES only (never values) if run
# unconfigured; see apps/worker's env contract and scripts/check-env.mjs.
CMD ["python", "-m", "agent_voice_worker.main", "start"]
