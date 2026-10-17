# Review 0

- Reviewed commit: `a9d56e74c27b24d1d0e70afc2aa738d330e89a52`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`node/src/yt_digest_node/daemon.py:163`) A failed heartbeat waits a full interval, which doesn't match the decision line

  `heartbeat_if_due` sets `last_heartbeat = time.monotonic()` when a heartbeat fails. The next try therefore happens only after another `HEARTBEAT_SECONDS`, not at the next poll cycle. docs/decisions.md says a failed heartbeat is "retried at the next cycle", which reads as the next loop iteration. Either the code or the decision line should be changed so they match.

- **minor** (`node/src/yt_digest_node/daemon.py:116`) A 401 on result or release during `--once` exits 1, and this isn't recorded in decisions.md

  `_call` raises `Unauthorized` on any 401. In `--once` this means a 401 on `/node/result` ends the run with exit 1 and leaves the other claimed jobs unposted. Spec section 9 states the 401 → exit 1 rule only for the loop, and says `--once` exits 0 after the claimed jobs. Treating 401 as fatal is a reasonable reading, but it is a choice the spec leaves open and it is not in docs/decisions.md.

- **minor** (`node/tests/test_daemon.py:271`) Some section 9 behaviours have no test

  No test covers: a 401 in loop mode exiting 1; heartbeats every `HEARTBEAT_SECONDS` during the loop; retries of `/node/release` after a network error or 5xx; or the `video_id` top-level field on `worker.call` lines for result and release. The ticket's acceptance list is fully covered; these gaps are beyond it.

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

  daemon.py implements `work [--once]`: the variables with their defaults and ranges; a heartbeat at start and then on each interval; a claim of CLAIM_BATCH jobs; lot 1's `run` in process; the outcome taken from the result status (all Status values exist in Outcome), with the transcript only when `ok`; a pipeline exception sends `error`. 5xx and network errors are retried after 1, 2 and 4 s, and 4xx is not retried. `--once` exits 1 when the heartbeat or claim fails. SIGTERM/SIGINT finish the current job, release the rest and exit 0; a 401 exits 1. It logs `service.started` and one `worker.call` per request (endpoint, status 0 on a network error, duration_ms), with video_id at top level for jobs. All bodies use the generated contracts. Nothing out of scope (OAuth, MCP, health states) was added.

- met: The change is covered by tests that fail without it.

  node/tests/test_daemon.py runs against a local fake HTTP Worker. It covers: the `--once` sequence and its bodies; a pipeline exception sending `error`; 503 retried and then succeeding; giving up after 3 retries; 409 not retried; a failed claim or heartbeat exiting 1; 401; a network error; a missing WORKER_URL or NODE_TOKEN exiting 2 with no request; SIGTERM in a subprocess releasing the unstarted jobs; stderr holding only JSON and never the token. e2e/tests/daemon.api.spec.ts processes okokokokok1 through `work --once` and reads the transcript with GET /ops/transcripts. None of this can pass without the new `work` command.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  There are five dated 2026-10-17 lines: the missing-variable output; falling back on invalid numbers; worker.call once per attempt plus the 30 s timeout; loop behaviour on a failed heartbeat or claim and jobs_in_progress; dropping a result after its retries and SIGTERM during `--once`. Small gaps: a 401 during `--once` result/release isn't recorded, and the heartbeat retry timing is described loosely (see the minor findings).

## Proposed learnings (not decided)

- When a daemon serializes nested pydantic models with `exclude_unset=True`, check that the nested models were built with every field set (here via `model_validate` from a full dict). Otherwise required fields can silently disappear from the wire.
- Signal-handling tests are more reliable in a subprocess with a deliberately slowed step that prints a readiness marker, so the signal arrives at a known point.
