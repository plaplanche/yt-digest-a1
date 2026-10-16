#!/usr/bin/env bash
# Generates TypeScript types and Pydantic v2 models from contracts/*.schema.json.
# With --check, regenerates into a temporary directory and exits 1 naming the stale files.
# Test hook: CONTRACTS_ROOT overrides the repository root (used by the tests on a copy).
set -euo pipefail
root="${CONTRACTS_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
mode="${1:-}"
case "$mode" in "" | --check) ;; *) echo "usage: $0 [--check]" >&2; exit 2 ;; esac

ts_rel=worker/src/contracts
py_rel=node/src/yt_digest_node/contracts

generate() { # generate <output root>
  local out="$1" schema name stem
  mkdir -p "$out/$ts_rel" "$out/$py_rel"
  printf '"""Generated from contracts/*.schema.json by scripts/contracts.sh; do not edit."""\n' >"$out/$py_rel/__init__.py"
  for schema in "$root"/contracts/*.schema.json; do
    name=$(basename "$schema" .schema.json)
    stem=${name//-/_}
    (cd "$root/worker" && npx --no-install json2ts --input "$schema" --bannerComment \
      "/* Generated from contracts/$name.schema.json by scripts/contracts.sh; do not edit. */" \
      --output "$out/$ts_rel/$name.ts")
    {
      echo "# Generated from contracts/$name.schema.json by scripts/contracts.sh; do not edit."
      uv run --locked --project "$root/node" datamodel-codegen --input "$schema" --input-file-type jsonschema \
        --output-model-type pydantic_v2.BaseModel --target-python-version 3.12 \
        --use-subclass-enum --use-specialized-enum --disable-timestamp --formatters ruff-format ruff-check \
        --use-annotated --field-constraints --custom-file-header ""
    } >"$out/$py_rel/$stem.py"
  done
}

if [[ "$mode" == "--check" ]]; then
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  generate "$tmp"
  stale=()
  while IFS= read -r f; do
    [[ -f "$root/$f" ]] && cmp -s "$tmp/$f" "$root/$f" || stale+=("$f")
  done < <(cd "$tmp" && find "$ts_rel" "$py_rel" -type f ! -name '*.pyc' | sort)
  while IFS= read -r f; do
    [[ -f "$tmp/$f" ]] || stale+=("$f")
  done < <(cd "$root" && find "$ts_rel" "$py_rel" -type f ! -name '*.pyc' ! -path '*/__pycache__/*' | sort)
  if ((${#stale[@]})); then
    echo "stale generated files (run ./scripts/contracts.sh):" >&2
    printf '  %s\n' "${stale[@]}" >&2
    exit 1
  fi
  echo "generated files are up to date"
else
  generate "$root"
fi
