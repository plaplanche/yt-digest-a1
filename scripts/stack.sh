#!/usr/bin/env bash
# Starts or stops the local stack (Worker on wrangler dev + mocks server): ./scripts/stack.sh <up|down>
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
stack="$root/.stack"

export WORKER_PORT="${WORKER_PORT:-8787}"
export MOCKS_PORT="${MOCKS_PORT:-8789}"
STACK_READY_TIMEOUT="${STACK_READY_TIMEOUT:-180}"
WORKER_URL="http://127.0.0.1:$WORKER_PORT"
MOCKS_URL="http://127.0.0.1:$MOCKS_PORT"
export WORKER_URL MOCKS_URL
export WRANGLER_SEND_METRICS=false

stop_one() {
  local pidfile="$stack/$1.pid" pid
  [[ -f "$pidfile" ]] || return 0
  pid="$(cat "$pidfile")"
  if [[ -n "$pid" ]]; then
    kill -TERM -- "-$pid" 2>/dev/null || true
    for _ in $(seq 1 50); do
      kill -0 -- "-$pid" 2>/dev/null || break
      sleep 0.1
    done
    kill -KILL -- "-$pid" 2>/dev/null || true
  fi
  rm -f "$pidfile"
}

down() {
  stop_one worker
  stop_one mocks
}

port_taken() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

fail() {
  echo "stack: $1" >&2
  down
  exit 1
}

up() {
  down
  for port in "$WORKER_PORT" "$MOCKS_PORT"; do
    if port_taken "$port"; then
      echo "stack: port $port is already taken" >&2
      exit 1
    fi
  done
  [[ -d worker/node_modules ]] || (cd worker && npm ci)
  [[ -d e2e/node_modules ]] || (cd e2e && npm ci)
  rm -rf "$stack/state"
  mkdir -p "$stack/state" "$stack/logs"
  : >"$stack/logs/worker.log"
  : >"$stack/logs/mocks.log"
  (cd worker && npx wrangler d1 migrations apply DB --local --persist-to "$stack/state") \
    >>"$stack/logs/worker.log" 2>&1 || {
    cat "$stack/logs/worker.log" >&2
    fail "applying the D1 migrations failed"
  }

  (cd e2e; setsid npx tsx mocks/server.ts >>"$stack/logs/mocks.log" 2>&1 & echo $! >"$stack/mocks.pid")
  local google_issuer="${GOOGLE_ISSUER:-$MOCKS_URL/google}"
  (cd worker; setsid npx wrangler dev --local --ip 127.0.0.1 --port "$WORKER_PORT" \
    --persist-to "$stack/state" \
    --var "PUBLIC_URL:$WORKER_URL" \
    --var "OPS_TOKEN:${OPS_TOKEN:-ops-local}" \
    --var "LEASE_SECONDS:${LEASE_SECONDS:-600}" \
    --var "ACCESS_TOKEN_TTL_SECONDS:${ACCESS_TOKEN_TTL_SECONDS:-3600}" \
    --var "REFRESH_TOKEN_TTL_SECONDS:${REFRESH_TOKEN_TTL_SECONDS:-2592000}" \
    --var "AUTH_CODE_TTL_SECONDS:${AUTH_CODE_TTL_SECONDS:-60}" \
    --var "AUTH_REQUEST_TTL_SECONDS:${AUTH_REQUEST_TTL_SECONDS:-600}" \
    --var "GOOGLE_ISSUER:$google_issuer" \
    --var "GOOGLE_CLIENT_ID:${GOOGLE_CLIENT_ID:-yt-digest-local}" \
    --var "GOOGLE_CLIENT_SECRET:${GOOGLE_CLIENT_SECRET:-local-google-secret}" \
    --var "ADMIN_EMAIL:${ADMIN_EMAIL:-alice@test}" \
    --var "TOKEN_ENC_KEY:${TOKEN_ENC_KEY:-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=}" \
    --var "ALLOWED_ORIGINS:${ALLOWED_ORIGINS:-}" \
    >>"$stack/logs/worker.log" 2>&1 & echo $! >"$stack/worker.pid")

  local deadline=$((SECONDS + STACK_READY_TIMEOUT))
  until curl -fsS -o /dev/null "$WORKER_URL/health" 2>/dev/null && curl -fsS -o /dev/null "$MOCKS_URL/health" 2>/dev/null; do
    if ((SECONDS >= deadline)); then
      fail "not ready after ${STACK_READY_TIMEOUT}s (see .stack/logs/)"
    fi
    sleep 0.5
  done
  echo "stack: ready $WORKER_URL"
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  *) echo "usage: $0 <up|down>" >&2; exit 2 ;;
esac
