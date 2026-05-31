#!/usr/bin/env bash
# Run a sundered-sprites generator with the skill's venv, cwd at the client so
# spritekit auto-loads public/assets/tokens.json. Usage:
#   .claude/skills/sundered-sprites/run.sh scripts/cinderbat.py /tmp/out
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PY="$ROOT/.claude/skills/sundered-sprites/.venv/bin/python"
[ -x "$PY" ] || { echo "venv missing — run: python3 -m venv .claude/skills/sundered-sprites/.venv && \
.claude/skills/sundered-sprites/.venv/bin/pip install pillow"; exit 1; }
GEN="$1"; shift
( cd "$ROOT/apps/client" && "$PY" "$ROOT/.claude/skills/sundered-sprites/$GEN" "$@" )
