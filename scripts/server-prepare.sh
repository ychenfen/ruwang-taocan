#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[server:prepare] workspace: $ROOT_DIR"
echo "[server:prepare] npm ci"
npm ci

echo "[server:prepare] migrate"
npm run migrate

if [[ "${RUN_SEED:-1}" == "1" ]]; then
  echo "[server:prepare] seed (idempotent)"
  npm run seed
fi

echo "[server:prepare] build frontend"
npm run build:all

echo "[server:prepare] done"
