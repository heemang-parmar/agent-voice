#!/usr/bin/env bash
# The full local quality gate. Every step must pass; none of them needs
# credentials. Run from anywhere: `pnpm check`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

step() {
  echo ""
  echo "==> $1"
}

step "format:check"
pnpm format:check

step "lint"
pnpm lint

step "typecheck"
pnpm typecheck

step "test"
pnpm test

step "build"
pnpm build

step "check:worker"
pnpm check:worker

step "check:secrets"
pnpm check:secrets

step "check:env (informational; does not fail the gate)"
node scripts/check-env.mjs || true

echo ""
echo "check: all gates passed."
