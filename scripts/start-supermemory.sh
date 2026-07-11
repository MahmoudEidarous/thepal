#!/usr/bin/env bash
# Start the local supermemory server with a memory agent that survives a
# real memory graph. Do NOT point OPENAI_* at Cerebras: its free tier has
# a tokens-per-minute quota that a single memory-agent prompt exceeds once
# the graph grows (~200 memories) — every doc then fails ingestion in ~7s
# with a swallowed error. OpenRouter deepseek has no such wall.
set -euo pipefail
cd "$(dirname "$0")/.."

ORKEY=$(grep '^OPENROUTER_API_KEY=' .env.local | cut -d= -f2-)
[ -n "$ORKEY" ] || { echo "OPENROUTER_API_KEY missing from .env.local"; exit 1; }

if curl -s -m 2 -o /dev/null http://localhost:6767/ 2>/dev/null; then
  echo "supermemory already running on :6767"
  exit 0
fi

cd "$HOME/.supermemory/data"
exec env \
  SUPERMEMORY_DATA_DIR="$HOME/.supermemory/data" \
  OPENAI_BASE_URL="https://openrouter.ai/api/v1" \
  OPENAI_API_KEY="$ORKEY" \
  OPENAI_MODEL="deepseek/deepseek-v4-flash" \
  OPENAI_FAST_MODEL="deepseek/deepseek-v4-flash" \
  "$HOME/.supermemory/bin/supermemory-server"
