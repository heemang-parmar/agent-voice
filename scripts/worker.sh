#!/usr/bin/env bash
# Runs the Python LiveKit worker through uv.
#
#   scripts/worker.sh check      lint, format check, type check and tests (no credentials needed)
#   scripts/worker.sh check-env  print which worker variables are missing (names only)
#   scripts/worker.sh dev        run the worker in development mode (needs credentials)
#   scripts/worker.sh start      run the worker in production mode (needs credentials)
#   scripts/worker.sh sync       install the locked Python environment only
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKER_DIR="$ROOT/apps/worker"
COMMAND="${1:-check}"

if ! command -v uv >/dev/null 2>&1; then
  echo "worker: 'uv' is not installed. See https://docs.astral.sh/uv/ (or: pipx install uv)." >&2
  exit 1
fi

# Load the root .env for dev/start without echoing any values.
load_env() {
  if [ -f "$ROOT/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    . "$ROOT/.env"
    set +a
  fi
}

cd "$WORKER_DIR"

case "$COMMAND" in
  sync)
    uv sync --frozen
    ;;
  check)
    echo "worker: uv sync --frozen"
    uv sync --frozen
    echo "worker: ruff format --check"
    uv run ruff format --check .
    echo "worker: ruff check"
    uv run ruff check .
    echo "worker: mypy"
    uv run mypy
    echo "worker: pytest"
    uv run pytest
    ;;
  check-env)
    load_env
    uv sync --frozen --quiet
    uv run python -m agent_voice_worker.main check-env
    ;;
  dev|start)
    load_env
    uv sync --frozen --quiet
    exec uv run python -m agent_voice_worker.main "$COMMAND"
    ;;
  *)
    echo "usage: scripts/worker.sh {check|check-env|dev|start|sync}" >&2
    exit 2
    ;;
esac
