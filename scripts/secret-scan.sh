#!/usr/bin/env bash
# Scans every tracked and untracked-but-not-ignored file for things that must
# never land in this repository: credential-shaped strings, private keys,
# hard-coded personal paths and private endpoints. Prints file:line and the
# pattern NAME that matched, never the matched value. Exit 1 on any finding.
#
# Portable to bash 3.2 (macOS default): no mapfile, no associative arrays.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "secret-scan: not a git repository" >&2
  exit 2
fi

# name|regex  (POSIX extended regex)
PATTERNS=(
  'openai-key|sk-[A-Za-z0-9_-]{20,}'
  'aws-access-key|AKIA[0-9A-Z]{16}'
  'github-token|gh[pousr]_[A-Za-z0-9]{36,}'
  'slack-token|xox[baprs]-[A-Za-z0-9-]{10,}'
  'private-key-block|-----BEGIN [A-Z ]*PRIVATE KEY-----'
  'jwt|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'
  'livekit-cloud-endpoint|wss://[A-Za-z0-9.-]+\.livekit\.cloud'
  'assigned-secret|(API_SECRET|API_KEY|SECRET_KEY|ACCESS_TOKEN|PASSWORD)[A-Z_]*[[:space:]]*[=:][[:space:]]*["'"'"']?[A-Za-z0-9+/_-]{24,}'
  'personal-home-path|(/Users/[A-Za-z0-9._-]+|/home/[A-Za-z0-9._-]+)/'
)

# Files that legitimately contain pattern definitions or opaque lockfile hashes.
EXCLUDE_REGEX='^(scripts/secret-scan\.sh|pnpm-lock\.yaml|apps/worker/uv\.lock)$'

file_list="$(git ls-files --cached --others --exclude-standard | grep -Ev "$EXCLUDE_REGEX" || true)"
file_count=0
findings=0

while IFS= read -r file; do
  [ -z "$file" ] && continue
  [ -f "$file" ] || continue
  file_count=$((file_count + 1))

  case "$(basename "$file")" in
    .env|.env.local|.env.development|.env.production|.env.*.local)
      echo "secret-scan: environment file present in repository listing: $file"
      findings=$((findings + 1))
      continue
      ;;
    *.pem|*.key|*.p12|*.pfx)
      echo "secret-scan: key material present in repository listing: $file"
      findings=$((findings + 1))
      continue
      ;;
  esac

  # Skip binary files.
  if ! grep -Iq . "$file" 2>/dev/null; then continue; fi

  for entry in "${PATTERNS[@]}"; do
    name="${entry%%|*}"
    regex="${entry#*|}"
    lines="$(grep -nE "$regex" "$file" 2>/dev/null | cut -d: -f1 || true)"
    [ -z "$lines" ] && continue
    while IFS= read -r line_no; do
      [ -z "$line_no" ] && continue
      echo "secret-scan: $file:$line_no matches pattern '$name'"
      findings=$((findings + 1))
    done <<EOF
$lines
EOF
  done
done <<EOF
$file_list
EOF

if [ "$findings" -gt 0 ]; then
  echo "secret-scan: $findings finding(s). Remove the value or move it to an ignored .env file." >&2
  exit 1
fi

echo "secret-scan: $file_count files scanned, no findings."
