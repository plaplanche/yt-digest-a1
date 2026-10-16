2026-10-16 Python is pinned to 3.12 only (`>=3.12,<3.13`) and the node package is built with hatchling, the simplest build backend for a src layout.
2026-10-16 ESLint uses the flat config with `typescript-eslint` recommended rules; the worker is an ES module package and `tsc` only type-checks (`noEmit`).
2026-10-16 `lint` runs mypy from `node/` so it uses `node/pyproject.toml`; shellcheck runs on every `*.sh` under `scripts/`.
2026-10-16 `contracts` passes with a message while `scripts/contracts.sh` does not exist.
