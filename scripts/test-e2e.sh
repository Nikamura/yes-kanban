#!/usr/bin/env bash
set -euo pipefail

# E2E test runner with isolated Convex instance and Vite port.
# Safe to run in parallel across multiple worktrees — each instance
# gets unique ports and a unique Docker Compose project name derived
# from the working directory.

# --- Dynamic port allocation based on working directory hash ----------
# We hash the repo root path to a number in range 0-999, then offset
# from base ports to avoid collisions with the dev app (3210/5173).
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HASH=$(echo -n "$REPO_ROOT" | shasum | cut -c1-4)  # 4 hex chars
OFFSET=$(( 16#$HASH % 1000 ))                       # 0–999

TEST_CONVEX_PORT=$(( 4000 + OFFSET ))
TEST_CONVEX_SITE_PORT=$(( 5000 + OFFSET ))
TEST_VITE_PORT=$(( 6000 + OFFSET ))

# Sanitise the repo path into a valid compose project name
PROJECT_SUFFIX=$(echo -n "$REPO_ROOT" | shasum | cut -c1-8)
COMPOSE_PROJECT="yes-kanban-test-${PROJECT_SUFFIX}"
COMPOSE_FILE="docker-compose.test.yml"

echo "[test] Instance: project=$COMPOSE_PROJECT convex=:$TEST_CONVEX_PORT vite=:$TEST_VITE_PORT"

# --- Cleanup ----------------------------------------------------------
cleanup() {
  echo "[test] Cleaning up..."
  if [ -n "${VITE_PID:-}" ]; then
    # Kill the process and all its children (vite spawns child node processes)
    pkill -P "$VITE_PID" 2>/dev/null || true
    kill "$VITE_PID" 2>/dev/null || true
    wait "$VITE_PID" 2>/dev/null || true
  fi
  docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" down -v 2>/dev/null || true
}
trap cleanup EXIT

# --- Start Convex backend ---------------------------------------------
echo "[test] Starting isolated Convex backend on port $TEST_CONVEX_PORT..."
TEST_CONVEX_PORT="$TEST_CONVEX_PORT" \
TEST_CONVEX_SITE_PORT="$TEST_CONVEX_SITE_PORT" \
  docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" up -d

echo "[test] Waiting for Convex to be healthy..."
for i in $(seq 1 30); do
  if curl -sf "http://localhost:$TEST_CONVEX_PORT/version" > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

# --- Generate admin key -----------------------------------------------
ADMIN_KEY=$(docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" exec -T convex-backend-test ./generate_admin_key.sh 2>/dev/null | grep "^convex-self-hosted" | tr -d '\r')
echo "[test] Admin key generated"

# --- Deploy schema ----------------------------------------------------
echo "[test] Deploying Convex functions..."
CONVEX_SELF_HOSTED_URL="http://127.0.0.1:$TEST_CONVEX_PORT" \
CONVEX_SELF_HOSTED_ADMIN_KEY="$ADMIN_KEY" \
  bunx convex dev --once 2>&1 | tail -3

# --- Start Vite -------------------------------------------------------
echo "[test] Starting Vite on port $TEST_VITE_PORT..."
VITE_CONVEX_URL="http://127.0.0.1:$TEST_CONVEX_PORT" \
  bunx --bun vite --port "$TEST_VITE_PORT" &
VITE_PID=$!
sleep 3

# --- Run Playwright tests ---------------------------------------------
echo "[test] Running Playwright tests..."
PLAYWRIGHT_BASE_URL="http://localhost:$TEST_VITE_PORT" \
  bunx playwright test --config=playwright.test.config.ts "$@"

echo "[test] Done!"
