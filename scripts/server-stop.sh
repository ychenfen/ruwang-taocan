#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT_DIR/.run"

collect_listener_pids() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -lntp 2>/dev/null | grep -E ":${port}[[:space:]]" | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true
    return
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | sort -u || true
    return
  fi
}

stop_port_listeners() {
  local name="$1"
  local port="$2"
  local pids
  pids="$(collect_listener_pids "$port" | tr '\n' ' ' | xargs || true)"
  if [[ -z "${pids:-}" ]]; then
    return
  fi

  echo "[server:stop] stopping lingering listeners for $name on :$port (pid=${pids})"
  kill $pids 2>/dev/null || true
  sleep 1

  local left
  left="$(collect_listener_pids "$port" | tr '\n' ' ' | xargs || true)"
  if [[ -n "${left:-}" ]]; then
    echo "[server:stop] force killing lingering listeners for $name on :$port (pid=${left})"
    kill -9 $left 2>/dev/null || true
  fi
}

stop_service() {
  local name="$1"
  local pid_file="$RUN_DIR/$name.pid"

  if [[ ! -f "$pid_file" ]]; then
    echo "[server:stop] $name not running (no pid file)"
    return
  fi

  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [[ -z "$pid" ]]; then
    rm -f "$pid_file"
    echo "[server:stop] $name pid file empty, cleaned"
    return
  fi

  if ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$pid_file"
    echo "[server:stop] $name already stopped, cleaned stale pid"
    return
  fi

  echo "[server:stop] stopping $name (pid=$pid)"
  kill "$pid" 2>/dev/null || true
  for _ in {1..20}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$pid_file"
      echo "[server:stop] $name stopped"
      return
    fi
    sleep 0.5
  done

  echo "[server:stop] force killing $name (pid=$pid)"
  kill -9 "$pid" 2>/dev/null || true
  rm -f "$pid_file"
}

stop_service "agent"
stop_service "admin"
stop_service "backend"

# Also clean orphan listeners that were started outside pid-file management.
stop_port_listeners "agent" "3002"
stop_port_listeners "admin" "3001"
stop_port_listeners "backend" "3000"

echo "[server:stop] done"
