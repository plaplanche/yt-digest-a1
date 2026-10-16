# Review 0

- Reviewed commit: `7c7091a6f96301b351c551eed7af02e3ea63fb7e`
- Reviewer model: claude-opus-5-5
- Verdict: **no-go** (the reviewer answered no-go)

## Findings

- **blocking** (`worker/src/node.ts:84`) Claim response order uses a different video_id order than the one used to pick the jobs

  SQLite picks the jobs with `ORDER BY priority DESC, created_at ASC, video_id ASC` using BINARY collation (code-unit order: '-' < digits < 'A-Z' < '_' < 'a-z'). The Worker then re-sorts the RETURNING rows with `a.video_id.localeCompare(b.video_id)`, which is ICU locale collation (case-insensitive first, punctuation first). Every id in one `POST /ops/jobs` gets the same `created_at`, so the video_id tie-break decides the order in the normal case, and real video ids mix upper and lower case. Example: for `Bxxxxxxxxxx` and `axxxxxxxxxx`, SQLite orders B before a, but the response lists a first. That breaks 8.3, which says the answer is "in that order" (the order the jobs were chosen in). The order test passes only because `vid(n)` ids are all lowercase letters and digits. Fix: compare with plain code-unit order (`a < b ? -1 : a > b ? 1 : 0`) for video_id, and for created_at to be safe. Add a test with mixed-case ids and ids containing `-` and `_`, and write the collation choice down in docs/decisions.md.

- **minor** (`worker/src/ops.ts:86`) A video id repeated in one POST /ops/jobs is reported both as enqueued and as existing

  With `video_ids: [x, x]`, the first INSERT changes 1 row and the second changes 0, so the answer is `{enqueued:[x], existing:[x]}`. The spec does not cover duplicates. Either deduplicate the ids or reject them, and record the choice in docs/decisions.md.

- **minor** (`worker/tests/nodes.worker.test.ts:250`) The under-supply part of the concurrency test only checks the total

  `sizes` is computed but only its sum is asserted. The test does not show that each concurrent claim got min(max_jobs, eligible jobs at that moment): for example, it does not check that at most one claim came back with fewer than 3 jobs while jobs remained. The first part (36 of 40, every claim full) does cover the no-short-claim property in the over-supply case.

- **minor** (`worker/tests/nodes.worker.test.ts:124`) Most new log events are untested

  Only `auth.bearer.rejected` with surface `node` is asserted. `node.enrolled`, `node.heartbeat`, `job.enqueued`, `job.claimed` (attrs `attempt`, `lease_seconds`, top-level `video_id`) and the ops-surface rejection have no test. The ticket lists them in the decided spec.

- **blocking** Definition of done not met: The change does what the ticket and spec/lot-2.md (and spec/lot-1.md, which still applies) say, and nothing more.

  Endpoints, token format, SHA-256 storage, 8.1 auth, heartbeat, the atomic batch claim, leases rows and the log events are implemented. The expiry sweep and result/release are deferred, as the ticket allows, and documented. But the claim response is re-sorted with localeCompare (worker/src/node.ts:84), so for mixed-case video ids it does not come back in the order 8.3 requires, which is the order SQLite used to choose the jobs.

- **blocking** Definition of done not met: Every choice the spec leaves open is written down in docs/decisions.md.

  Seven new dated lines cover the deferred sweep, the 404 for result/release, the claim SQL, the job.enqueued shape, ops rejection logging, an invalid LEASE_SECONDS and the empty-body rule. Missing: the collation behind 'video_id ascending' (left open by the spec and currently inconsistent) and how duplicate ids in one POST /ops/jobs are handled.

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

- **not met**: The change does what the ticket and spec/lot-2.md (and spec/lot-1.md, which still applies) say, and nothing more.

  Endpoints, token format, SHA-256 storage, 8.1 auth, heartbeat, the atomic batch claim, leases rows and the log events are implemented. The expiry sweep and result/release are deferred, as the ticket allows, and documented. But the claim response is re-sorted with localeCompare (worker/src/node.ts:84), so for mixed-case video ids it does not come back in the order 8.3 requires, which is the order SQLite used to choose the jobs.

- met: The change is covered by tests that fail without it.

  worker/tests/nodes.worker.test.ts covers every acceptance criterion: the 401 cases, heartbeat, empty queue, default 3, ordering, leased/attempts/tried_nodes, skipping a node already tried, priority raised only upwards, and concurrent claims on Miniflare D1. e2e/tests/claims.api.spec.ts runs 2 nodes claiming 6 jobs. None of these routes existed before, so the tests would fail without the change. Gaps: no mixed-case ordering test and no log-event assertions beyond auth.bearer.rejected.

- **not met**: Every choice the spec leaves open is written down in docs/decisions.md.

  Seven new dated lines cover the deferred sweep, the 404 for result/release, the claim SQL, the job.enqueued shape, ops rejection logging, an invalid LEASE_SECONDS and the empty-body rule. Missing: the collation behind 'video_id ascending' (left open by the spec and currently inconsistent) and how duplicate ids in one POST /ops/jobs are handled.

## Proposed learnings (not decided)

- When SQL decides an order and JS re-sorts the result, use code-unit comparison in JS to match SQLite's BINARY collation; localeCompare differs for mixed case and for '-'/'_'.
- Jobs enqueued in one batch share created_at, so the video_id tie-break is the common case, not an edge case; test it with realistic mixed-case ids.
- For concurrency tests, assert per-claim sizes rather than only totals, so a short claim cannot hide behind a correct sum.
