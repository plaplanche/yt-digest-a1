2026-10-16 Python is pinned to 3.12 only (`>=3.12,<3.13`) and the node package is built with hatchling, the simplest build backend for a src layout.
2026-10-16 ESLint uses the flat config with `typescript-eslint` recommended rules; the worker is an ES module package and `tsc` only type-checks (`noEmit`).
2026-10-16 `lint` runs mypy from `node/` so it uses `node/pyproject.toml`; shellcheck runs on every `*.sh` under `scripts/`.
2026-10-16 `contracts` passes with a message while `scripts/contracts.sh` does not exist.
2026-10-16 Generators are dev tools pinned by lockfiles: `json-schema-to-typescript` (npm) and `datamodel-code-generator` (uv dev group); `ajv` (runtime dependency of the worker) and `pydantic` (runtime dependency of the node) validate at runtime.
2026-10-16 In the log schema the catalogue is a `$defs/LogEventName` enum, so it becomes the TS union `LogEventName` and the Python `StrEnum` `LogEventName`; `attrs` is a free object (per-event attrs are not validated in lot 1).
2026-10-16 Optional `request_id` and `video_id` are omitted from the log line when absent; `service` is fixed by each logger (`node`, `worker`) and `ts` is set by the logger.
2026-10-16 `contracts.sh` honours `CONTRACTS_ROOT` (default: the repository) so the staleness tests can run `--check` on a copy of the tree.
2026-10-16 The TS logger writes with `console.error` (standard error); `tsconfig` gains `resolveJsonModule` and `node` types for the schema import and the tests.
