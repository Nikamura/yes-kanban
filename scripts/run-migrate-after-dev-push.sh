#!/usr/bin/env bash
# Invoked by `convex dev --run-sh` after the first successful push (see package.json dev:convex).
set -euo pipefail
cd "$(dirname "$0")/.."
exec bun run migrate
