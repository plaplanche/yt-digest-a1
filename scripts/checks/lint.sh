#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
uv sync --locked --project node
uv run --locked --project node ruff check node
uv run --locked --project node ruff format --check node
(cd node && uv run --locked mypy --strict .)
(cd worker && npm ci && npx tsc --noEmit && npx eslint .)
(cd e2e && npm ci && npx tsc --noEmit && npx eslint .)
mapfile -t scripts < <(find scripts -name '*.sh' | sort)
uvx --from shellcheck-py shellcheck "${scripts[@]}"
