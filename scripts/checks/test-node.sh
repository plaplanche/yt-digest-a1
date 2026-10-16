#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
uv sync --locked --project node
uv run --locked --project node pytest node/tests
