# Review 0

- Reviewed commit: `a83ed8dccf21a35daec0929d2f2b42f2449e19f5`
- Reviewer model: claude-opus-5-5
- Verdict: **no-go** (the reviewer answered no-go)

## Findings

- **blocking** (`scripts/checks/contracts.sh:5`) The contracts check does not install the npm dependencies it needs, so it fails in its own CI job

  scripts/contracts.sh runs `npx --no-install json2ts` from worker/. The check script runs `./scripts/contracts.sh --check` without first running `npm ci`. In ci/jobs.json, `contracts` is a separate job on a fresh runner, so worker/node_modules does not exist and json2ts cannot be resolved. Spec 3.1 says 'each check installs its own dependencies'. The local replay passed only because an earlier check (lint) had already populated node_modules. Fix: run `(cd worker && npm ci)` in scripts/checks/contracts.sh, or inside contracts.sh. `uv run --locked` syncs the Python side by itself, but npx --no-install does not install anything.

- **blocking** (`node/tests/test_contracts.py:73`) The Python staleness tests depend on worker/node_modules, which the test-node job never installs

  The `tree` fixture symlinks REPO/worker/node_modules, and scripts/contracts.sh then runs `npx --no-install json2ts`. scripts/checks/test-node.sh only runs `uv sync`. In the separate `test-node` CI job, node_modules is missing, so test_check_passes_on_fresh_tree fails (and the other two pass only by accident: the script exits non-zero for the wrong reason). The same root cause as the finding above. Either the test-node check installs the worker dependencies, or these tests are written so they don't need them.

- **minor** (`docs/decisions.md:5`) The decision says ajv is a runtime dependency, but it is a devDependency

  The decision line calls `ajv` a 'runtime dependency of the worker', but worker/package.json lists it under devDependencies, even though src/log.ts imports it at runtime. Either move it to `dependencies` or correct the decision line.

- **minor** (`node/src/yt_digest_node/log.py:21`) emit lets callers override ts, service and attrs-level structure

  `**fields` is spread after the fixed keys, so `emit('service.started', service='worker')` or `ts=...` is accepted. This contradicts the decision that `service` is fixed by each logger and `ts` is set by the logger. The TS logger correctly limits fields to level, request_id, video_id and attrs. Reject or ignore those keys in Python as well.

- **minor** (`node/src/yt_digest_node/contracts/log_event.py:41`) The Python model accepts null request_id and video_id, which the schema rejects

  The generated `str | None = None` accepts an explicit null, but the schema only allows a string when the field is present, and ajv rejects null. So the two languages disagree on the same contract. Not harmful to emitted lines because of exclude_none, but it is drift that no test covers.

- **minor** (`node/tests/test_contracts.py:14`) No test covers the nullable fields of the transcript result

  The spec makes lang, source and sponsor_ratio null unless the status is ok. The only valid fixture has all of them set. `sponsor_ratio: Annotated[float | None, Field(ge=0.0, le=1.0)]` has range constraints on a nullable type, and nothing checks that a non-ok result with nulls is accepted in Python and in TS. Add a valid `no_transcript` result to both suites.

- **minor** (`scripts/contracts.sh:40`) --check ignores orphaned generated files

  --check only compares the files that regeneration produces. A committed generated file whose schema was removed, or any extra file in worker/src/contracts or the Python contracts package, is never reported.

- **blocking** Definition of done not met: The change does what the ticket and spec/lot-1.md say, and nothing more.

  The schemas match 4.1 and 4.2, the generators match 4.3 (header line, TS union, StrEnum) and the loggers match 4.4. However, the `contracts` check (and the test-node staleness tests) need worker/node_modules without installing them. This breaks spec 3.1 ('each check installs its own dependencies') and will fail in the separate CI jobs of ci/jobs.json.

## Definition of done

- met: check lint passes

  Replayed by Ariane: exit 0.

- met: check contracts passes

  Replayed by Ariane: exit 0.

- met: check test-node passes

  Replayed by Ariane: exit 0.

- met: check test-worker passes

  Replayed by Ariane: exit 0.

- **not met**: The change does what the ticket and spec/lot-1.md say, and nothing more.

  The schemas match 4.1 and 4.2, the generators match 4.3 (header line, TS union, StrEnum) and the loggers match 4.4. However, the `contracts` check (and the test-node staleness tests) need worker/node_modules without installing them. This breaks spec 3.1 ('each check installs its own dependencies') and will fail in the separate CI jobs of ci/jobs.json.

- met: The change is covered by tests that fail without it.

  node/tests/test_contracts.py, node/tests/test_log.py, worker/tests/contracts.test.ts, worker/tests/log.test.ts and worker/tests/contracts-check.test.ts cover each acceptance criterion: valid and invalid results, unknown event, hand edit and schema change named by --check, and the loggers raising and throwing. They would fail without the change. The nullable fields of the result are not covered.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Five dated lines cover: the generators and validators, the $defs catalogue, free attrs, omitted optional fields, the fixed service and ts, the CONTRACTS_ROOT hook, the console.error logger and the tsconfig changes. One line is wrong: it calls ajv a 'runtime dependency' while it is a devDependency.

## Proposed learnings (not decided)

- Each CI job in ci/jobs.json runs on a fresh runner: a check script must install every dependency it uses (npm ci, uv sync). A local `check.sh all` hides this because earlier checks populate node_modules.
- `npx --no-install` never installs: any script that uses it needs an explicit `npm ci` before it in the check that calls it.
- When a logger fixes fields such as service and ts, make sure caller kwargs cannot override them in either language.
