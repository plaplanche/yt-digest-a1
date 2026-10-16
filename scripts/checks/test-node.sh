#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
uv sync --locked --project node
(cd worker && npm ci)
uv run --locked --project node pytest node/tests
