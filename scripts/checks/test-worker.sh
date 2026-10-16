#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
cd worker
npm ci
npx vitest run
