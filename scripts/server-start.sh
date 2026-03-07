#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT_DIR/.run"
LOG_DIR="$ROOT_DIR/logs"

mkdir -p "$RUN_DIR" "$LOG_DIR"
cd "$ROOT_DIR"

if [[ ! -d "$ROOT_DIR/admin-web/.next" || ! -d "$ROOT_DIR/agent-web/.next" ]]; then
  echo "[server:start] missing frontend build output (.next)."
  echo "[server:start] run: npm run server:prepare"
  exit 1
fi

if [[ -z "${JWT_SECRET:-}" ]]; then
  if [[ ! -f "$ROOT_DIR/backend/.env" ]] || ! grep -qE '^JWT_SECRET=' "$ROOT_DIR/backend/.env"; then
    echo "[server:start] JWT_SECRET is required."
    echo "[server:start] export JWT_SECRET=... or set it in backend/.env"
    exit 1
  fi
fi

start_service() {
  local name="$1"
  local cmd="$2"
  local pid_file="$RUN_DIR/$name.pid"
  local log_file="$LOG_DIR/$name.log"

  if [[ -f "$pid_file" ]]; then
    local old_pid
    old_pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ -n "$old_pid" ]] && kill -0 "$old_pid" 2>/dev/null; then
      echo "[server:start] $name already running (pid=$old_pid)"
      return
    fi
    rm -f "$pid_file"
  fi

  nohup bash -lc "cd \"$ROOT_DIR\" && $cmd" >>"$log_file" 2>&1 &
  local new_pid=$!
  echo "$new_pid" > "$pid_file"
  echo "[server:start] started $name (pid=$new_pid, log=$log_file)"
}

start_service "backend" "npm run start:backend"
start_service "admin" "npm run start:admin"
start_service "agent" "npm run start:agent"

echo "[server:start] all start commands submitted"
echo "[server:start] check status with: npm run server:status"
