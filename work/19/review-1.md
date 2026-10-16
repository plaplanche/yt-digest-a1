# Review 1

- Reviewed commit: `763ebd2e7bd1cd10a4318ae61bc349596de32278`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`worker/src/node.ts:58`) Retrying a claim is not idempotent, and decisions.md does not say so

  Section 8.9 says that retrying any `/node/*` request after a network failure has no side effect beyond the first. A retried `/node/claim` leases a new set of jobs. The jobs from the lost answer stay leased until expiry (next ticket), and the node is recorded in their `tried_nodes`. A fix may be out of reach in lot 2, but this is a choice the spec leaves open, and docs/decisions.md does not record it.

- **minor** (`worker/src/ops.ts:76`) `priority` has no upper bound

  `Number.isInteger(1e300)` is true, so a very large priority reaches the D1 bind. It probably fails there with a 500 instead of a 400 `invalid_request`. Not required by the spec.

- **minor** (`e2e/tests/claims.api.spec.ts:17`) E2E-13 is only partly covered

  Section 13 says E2E-13 ends with all 6 jobs done. That needs `/node/result`, which belongs to the next ticket. This test checks only that each job is handed out once. The next ticket must extend it.

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

  These are in place: `POST /ops/nodes` (token `ytd_node_` + 43 base64url characters, stored as hex SHA-256, 409 on an existing node), `POST /ops/jobs` (dedupe, priority only goes up, reported in request order) and `GET /ops/jobs/<id>`. Node authentication (8.1) runs before the body is read, and the operator token is refused. Heartbeat (8.2) answers healthy/run/hourly_budget. Claim (8.3): a single conditional `UPDATE … WHERE video_id IN (SELECT … ORDER BY priority DESC, created_at, video_id LIMIT) RETURNING` plus a `leases` INSERT, in one D1 batch (8.9). The five log events use the attrs of section 12. The parts left for later (expiry sweep, result/release answering 404) are deferred as the ticket allows and recorded in decisions.md.

- met: The change is covered by tests that fail without it.

  worker/tests/nodes.worker.test.ts covers every Worker acceptance criterion: the three 401 cases, heartbeat, empty queue, default of 3, ordering, leased/attempts/tried_nodes/leases row, skipping a node already tried, priority only going up, and logs. It also runs 12 concurrent claims and then 4 more on the local D1, checking there are no duplicates and that claims are full or the sizes are [0,0,1,3]. e2e/tests/claims.api.spec.ts (api project) has 2 nodes claim 6 jobs concurrently. All of these fail without the new routes. The replayed checks are green.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Nine dated lines cover the deferred expiry sweep, result/release answering 404, the claim batch design, the `job.enqueued` granularity, `auth.bearer.rejected` on ops, invalid LEASE_SECONDS, the empty body on claim, BINARY order of video ids, and deduplication. One gap, minor: claim retry idempotence (8.9) is not recorded.

## Proposed learnings (not decided)

- When `RETURNING` picks rows inside an UPDATE, the result has no order, so the Worker has to sort it again. That sort must use code-unit comparison to match SQLite BINARY collation, not `localeCompare`.
- Writing the `leases` rows with `INSERT … SELECT` from the jobs just leased, in the same D1 batch as the claiming UPDATE, keeps the claim atomic without reading the rows back first.
- Section 8.9's rule that retrying a request has no side effect cannot fully hold for `/node/claim`. Each ticket touching it should record how a retried claim behaves.
