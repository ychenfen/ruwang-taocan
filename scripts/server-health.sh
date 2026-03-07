#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:3000}"
export ADMIN_WEB_URL="${ADMIN_WEB_URL:-http://127.0.0.1:3001}"
export AGENT_WEB_URL="${AGENT_WEB_URL:-http://127.0.0.1:3002}"

node scripts/smoke-live.mjs
