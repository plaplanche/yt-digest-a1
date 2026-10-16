#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
if [[ -x scripts/contracts.sh ]]; then
  ./scripts/contracts.sh --check
else
  echo "no scripts/contracts.sh yet: nothing to check"
fi
