#!/usr/bin/env bash
# Starts the web app and (when configured) the worker together for local
# development. The web app always starts; the worker starts only if all of
# its required variables are present, otherwise the missing NAMES are listed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

pids=()
cleanup() {
  for pid in "${pids[@]:-}"; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

echo "dev: starting web at http://localhost:3000"
pnpm --filter @agent-voice/web dev &
pids+=($!)

if node scripts/check-env.mjs --component worker --strict >/dev/null 2>&1 && command -v uv >/dev/null 2>&1; then
  echo "dev: starting worker"
  bash scripts/worker.sh dev &
  pids+=($!)
else
  echo "dev: worker not started (missing configuration or uv). Names missing:"
  node scripts/check-env.mjs --component worker || true
  echo "dev: the web UI still works in demo mode (fixture playback) without credentials."
fi

wait
