# Review 0

- Reviewed commit: `352a289c8f90dbba8a89765e65291838fcf7238f`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`scripts/contracts.sh:35`) The Python $ref fix is hard-coded to TranscriptResult and runs on every module

  `sed 's/\.Schema\b/.TranscriptResult/g'` runs on the output for every schema. It assumes that any cross-file `$ref` points to transcript-result. A future `$ref` to another schema file would silently be renamed to the wrong type. The TypeScript side reads the title from the referenced schema (contracts-refs.cjs), but the Python side does not. Deriving the class name from the referenced schema's `title` would be safer. It is correct for today's single `$ref`.

- **minor** (`scripts/contracts.sh:16`) The temporary directory from generate() leaks when generation fails

  `tmpdir=$(mktemp -d)` is only removed at line 38. Under `set -e`, a failing json2ts or datamodel-codegen run exits before that, so the directory is left behind. The `--check` path has its own trap, but only for `$tmp`.

- **minor** (`node/tests/test_node_contracts.py:43`) The heartbeat 'bad value' case only repeats the extra-field case

  In CASES, the bad value for NodeHeartbeatRequest is `{"extra": 1}`, which the extra-field assertion of the same test already covers. No bad-value check on a real field (for example an empty version, a negative uptime_s or a disk_free_ratio of 1.5) is run in Python, while the TypeScript test does check them. The rejections the ticket requires (missing version, max_jobs of 0 or 11, unknown outcome, broken transcript, extra field) are all covered.

- **minor** (`contracts/log-event.schema.json:6`) The whole log-event schema was reformatted

  The file went from compact to fully expanded JSON. Its meaning is unchanged, apart from the 19 added events, but the diff is noisier than it needs to be and the style no longer matches the other schemas, which stay compact.

## Definition of done

- met: check lint passes

  Replayed by Ariane: exit 0.

- met: check contracts passes

  Replayed by Ariane: exit 0.

- met: check test-node passes

  Replayed by Ariane: exit 0.

- met: check test-worker passes

  Replayed by Ariane: exit 0.

- met: check e2e passes

  Replayed by Ariane: exit 0.

- met: The change does what the ticket and spec/lot-2.md (and spec/lot-1.md, which still applies) say, and nothing more.

  There are seven node schemas plus error.schema.json, all matching spec 4.1/4.2 field for field: version 1–64 characters, max_jobs 1–10 and optional, lease_id at least 16 characters in the claim response, a nullable timestamp pattern, a video_id pattern, `transcript` as a required key that is either the `$ref` or null, and `additionalProperties: false` on every object, including nested ones. The log-event enum gains exactly the 19 events of section 12. Generated TypeScript imports TranscriptResult from ./transcript-result.js, and the Python module does `from . import transcript_result`. No routes, stack or daemon code was added.

- met: The change is covered by tests that fail without it.

  worker/tests/node-contracts.test.ts validates each schema with Ajv against a valid instance plus an extra field, max_jobs of 0 and 11, an unknown outcome, a broken transcript and a missing version. node/tests/test_node_contracts.py checks the same cases on the generated Pydantic models. Both languages have a test that the generated result-request type uses the generated TranscriptResult and holds no second definition. log.test.ts and test_log.py each accept a lot 2 event (job.claimed and worker.call), and the existing tests that reject events outside the catalogue are kept. contracts-check.test.ts covers --check on a fresh tree and on stale files. All of these would fail without the new schemas or generated files. All blocking checks are green.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Two dated lines were added. One covers how a `$ref` is generated (a TypeScript import or a Pydantic module reference, done in contracts.sh). The other covers `transcript` as anyOf `$ref`/null and reusing lot 1's timestamp pattern. The other constraints come straight from the spec.

## Proposed learnings (not decided)

- When a generator post-processes cross-file $refs, derive the type name from the referenced schema's title in every language. A hard-coded sed rename only works while there is a single $ref.
- Parametrized 'bad value' cases should test a real field constraint, not repeat the extra-field case, or the language test suites drift apart.
- Avoid reformatting whole schema files in a change that only extends an enum; it hides the real diff.
