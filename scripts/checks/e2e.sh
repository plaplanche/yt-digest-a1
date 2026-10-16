#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
cd e2e
npm ci
browser=1
if [[ -n "${CI:-}" ]]; then
  npx playwright install --with-deps chromium
elif ! timeout 120 npx playwright install chromium; then
  browser=0
  echo "e2e: chromium unavailable, browser project skipped"
fi
cd ..
status=0
trap './scripts/stack.sh down' EXIT
LEASE_SECONDS=2 ./scripts/stack.sh up || status=$?
if ((status == 0)); then
  args=()
  ((browser == 1)) || args+=(--project=api)
  (cd e2e && npx playwright test "${args[@]}") || status=$?
fi
if ((status != 0)); then
  mkdir -p ci-artifacts
  cp -r .stack/logs ci-artifacts/ 2>/dev/null || true
  cp -r e2e/playwright-report ci-artifacts/ 2>/dev/null || true
fi
exit "$status"
