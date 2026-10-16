# Review 1

- Reviewed commit: `a0c6383b6ac2ae308ea1fcd9df8828b8680b5a07`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`worker/src/log.ts:7`) Ajv compiles the validator at runtime with generated code

  Ajv2020.compile builds the validator with `new Function`. Cloudflare Workers do not allow generating code from strings at runtime, so this logger will throw on load once the worker is deployed (a later lot). Lot 1 only runs on Node 22, so nothing breaks now. Either precompile the validator with ajv standalone code from contracts.sh, or record this limit in docs/decisions.md (the ajv line there does not mention it).

- **minor** (`worker/src/log.ts:11`) The logger does not enforce the Service column of the catalogue

  Spec 4.2 says `fetch.transcript` and `sponsorblock.call` are node events, but `log("fetch.transcript")` is accepted by the worker logger. The schema cannot express this, and the spec only requires catalogue membership, so this conforms. It should still be written down as a lot-1 choice next to the 'attrs not validated' line.

- **minor** (`scripts/contracts.sh:51`) Generation without --check never removes orphaned files, but --check reports them

  If a schema is removed or renamed, plain `./scripts/contracts.sh` leaves the old generated files in place and `--check` keeps failing until someone deletes them by hand. Either clear the output directories before generating, or document the behaviour.

- **minor** (`scripts/checks/contracts.sh:5`) The fallback for a missing contracts.sh is now dead and can hide a regression

  scripts/contracts.sh now exists, but the check still passes with a message when it is missing or not executable (for example after a lost chmod +x). The `contracts` check should now fail in that case, and the matching decisions.md line should be updated.

- **minor** (`worker/tests/contracts.test.ts:1`) No direct schema test of log lines in TypeScript

  The acceptance criterion asks both languages to accept a valid log line and reject one with an unknown event. TypeScript covers this only through log.test.ts, which validates with the same compiled schema. That is acceptable, but a direct schema test would mirror the Python test_unknown_log_event_is_rejected.

## Definition of done

- met: check lint passes

  Replayed by Ariane: exit 0.

- met: check contracts passes

  Replayed by Ariane: exit 0.

- met: check test-node passes

  Replayed by Ariane: exit 0.

- met: check test-worker passes

  Replayed by Ariane: exit 0.

- met: The change does what the ticket and spec/lot-1.md say, and nothing more.

  Both schemas match spec 4.1 and 4.2: the 11-character video_id pattern, the status enum, the nullable lang, source and sponsor_ratio, additionalProperties false, ts with milliseconds and Z, and the event catalogue. contracts.sh generates TS into worker/src/contracts and Pydantic v2 into node/src/yt_digest_node/contracts, each file with a 'do not edit' header line. The catalogue becomes a TS union `LogEventName` and a Python `StrEnum`. --check regenerates into mktemp, names the stale files and exits 1. emit() raises ValueError and log() throws on unknown events or fields. The extras (CONTRACTS_ROOT test hook, orphan detection) are small and documented. No pipeline behaviour was added.

- met: The change is covered by tests that fail without it.

  Python: test_contracts.py covers valid and null-filled results, rejects an extra field, a bad video_id and a bad status, accepts a valid log event and rejects an unknown one. It also runs --check on a copied tree for a hand edit, a schema change and an orphan file. test_log.py checks the stderr line, raising on an unknown event or field, and rejecting overrides and nulls. TypeScript: contracts.test.ts covers the transcript result cases. contracts-check.test.ts covers a hand edit and a schema change, naming both generated files. log.test.ts covers a valid line, an unknown event that throws and an unknown field that throws. These tests import the new modules or run the new script, so they fail without the change.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Seven dated lines cover the generators and validators, the $defs catalogue and free attrs, omitting optional fields, CONTRACTS_ROOT, console.error and the tsconfig changes, npm ci in the checks, and the Python logger rejecting nulls and overrides. Two small gaps are reported as minor findings: the Service column is not enforced, and ajv runtime codegen will not work in Workers.

## Proposed learnings (not decided)

- Runtime JSON Schema validation with ajv compile() uses new Function, which Cloudflare Workers forbid; for worker code, prefer precompiled standalone validators generated next to the types.
- Running staleness checks on a copy of the tree through an env root override (CONTRACTS_ROOT) lets tests prove that --check fails without touching the real repository.
- datamodel-code-generator maps optional, non-nullable JSON Schema fields to `X | None = None`, so the Pydantic model is looser than the schema; code that writes the contract must reject null itself.
