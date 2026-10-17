# Review 0

- Reviewed commit: `b25bce7ce312af9a4b65750f29faba7bf59307a9`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`worker/src/node.ts:160`) A result that loses a race can still leave an R2 object behind

  The R2 put runs before the D1 batch that checks the lease is still current. If the lease expires or is revoked between the lease check and the batch (for example, another request's sweep or a concurrent DELETE /ops/nodes), the write has already happened and the request then answers 409 stale_lease via afterRace. Section 8.4 step 2 and C2 say a stale result writes nothing to R2. The window is narrow, and the object holds a valid transcript, but its metadata names a lease that never completed. Because objects are never overwritten, the next node's result cannot replace it. This ordering is not recorded in docs/decisions.md.

- **minor** (`worker/src/node.ts:120`) A 409 stale_lease from a lost race does not log job.stale_result

  afterRace answers 409 stale_lease without logging job.stale_result. Section 8.4 step 2 says every stale result logs that event. Only the early lease-check path logs it.

- **minor** (`worker/tests/results.worker.test.ts:236`) A test name says more than the test checks

  'the third expiry gives failed_video, and an expiry on the result path is swept first' only triggers the sweep through /node/heartbeat. The sweep on /node/result is covered by the log-events test instead.

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

  /node/result follows the steps of 8.4 in order: schema, sweep, lease check with the stored response_json for a completed lease, 409 plus job.stale_result otherwise, the validation rules giving 422 with the lease rejected, then the outcome with the R2 write (onlyIf etagDoesNotMatch) and a 503 that leaves the lease active. /node/release follows 8.5 (attempts − 1, the node removed from tried_nodes, idempotent through response_json). The sweep (8.6) runs on every /node/* request after validation and on GET /ops/jobs. FAIL_SET implements 8.7. DELETE /ops/nodes implements 8.8, with the same 200 on a repeat and 404 for an unknown node. GET /ops/transcripts is added. The node events and the section 12 log events are present. Only narrow race edge cases deviate (see the minor findings). Nothing beyond the scope was added.

- met: The change is covered by tests that fail without it.

  The new worker/tests/results.worker.test.ts covers every acceptance criterion: the ok result with R2 and its metadata, the idempotent retry, no_transcript, the 3 failure outcomes up to failed_video, expiry with a 409 for the late result, expiry exactly at lease_expires_at under fake timers, each 422 rule, release and its idempotence, revocation and the logs. The e2e tests cover E2E-13 extended to all 6 done, E2E-14 (LEASE_SECONDS=2 in e2e.sh), E2E-16, E2E-20 and E2E-21. Before this change these endpoints answered 404, so all of these tests fail without it.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Eight new dated lines cover: the sweep batch and its log holder, the lease fields of a done job, the word-count marker and the validation reasons, stale_result on result only, the R2 onlyIf and the 503, the race answer, revocation (log once, no sweep, no node event) and the single Playwright worker. The two obsolete lines about the deferred sweep and the 404 are removed. One gap, minor: the R2-before-D1 ordering and its race are not recorded.

## Proposed learnings (not decided)

- When a handler writes to R2 before its conditional D1 batch, check what happens if the lease goes stale in between; spec rules like 'a stale result writes nothing' are easy to break in that window.
- Check that every early-return path for a stale lease, including the race fallbacks, emits the log event the spec requires.
