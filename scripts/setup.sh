#!/usr/bin/env bash
# One-time local setup: installs the JavaScript workspace and the Python
# worker environment, then creates a root .env from the example if none exists.
# Never prints configuration values.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "setup: '$1' is required. $2" >&2
    return 1
  fi
}

need node "Install Node.js 20.9 or newer (https://nodejs.org)."
need pnpm "Install pnpm 9 or newer (corepack enable pnpm, or https://pnpm.io/installation)."

echo "setup: installing JavaScript workspace (pnpm install --frozen-lockfile)"
pnpm install --frozen-lockfile

if command -v uv >/dev/null 2>&1; then
  echo "setup: installing Python worker environment (uv sync --frozen)"
  (cd apps/worker && uv sync --frozen)
else
  echo "setup: 'uv' not found; skipping the Python worker. Install it from https://docs.astral.sh/uv/ and re-run."
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "setup: created .env from .env.example (ignored by git). Fill in the values before starting the voice path."
else
  echo "setup: .env already exists; leaving it untouched."
fi

echo ""
node scripts/check-env.mjs || true
echo ""
echo "setup: done. Next: 'pnpm check' (no credentials needed) or 'pnpm dev'."
