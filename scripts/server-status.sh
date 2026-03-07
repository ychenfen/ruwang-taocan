#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT_DIR/.run"

print_service_status() {
  local name="$1"
  local port="$2"
  local path="$3"
  local pid_file="$RUN_DIR/$name.pid"

  local pid=""
  local proc_state="STOPPED"
  if [[ -f "$pid_file" ]]; then
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      proc_state="RUNNING"
    else
      proc_state="STALE_PID"
    fi
  fi

  local http_state="DOWN"
  if curl -fsS "http://127.0.0.1:${port}${path}" >/dev/null 2>&1; then
    http_state="UP"
  fi

  echo "$name pid=${pid:-none} process=$proc_state http=$http_state port=$port"
}

print_service_status "backend" "3000" "/health"
print_service_status "admin" "3001" "/login"
print_service_status "agent" "3002" "/login"
