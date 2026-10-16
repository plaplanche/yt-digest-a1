# Review 0

- Reviewed commit: `8bbb3223709a3f659d83042024c7602595dca68a`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`scripts/stack.sh:67`) Settings of 5.2 are not passed to the mocks server

  The ticket says the configuration of 5.2 is passed to 'the Worker and the mocks server', and spec 5.3 says the mocks server reads MOCKS_PORT, GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET. stack.sh applies the defaults for GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET only inside the Worker's --var arguments and never exports them. So the mocks process only sees them when the caller already exported them, and the defaults never reach it. Nothing reads them yet, but the fake Google ticket (07) will need these defaults to match the Worker's. The decisions line ('passes every setting ... to the Worker') also only covers the Worker. Fix: export them with their defaults, as is already done for WORKER_PORT and MOCKS_PORT.

- **minor** (`scripts/stack.sh:87`) Readiness loop does not notice a process that died

  If wrangler dev or the mocks server exits right away (bad config, crash), `up` keeps polling until STACK_READY_TIMEOUT (180 s by default) runs out before it fails. The spec allows this, but checking `kill -0` on both PIDs inside the loop would fail fast with a clearer reason.

- **minor** (`e2e/tests/stack.api.spec.ts:3`) Stack behaviours of the acceptance criteria have no automated test

  The Playwright test covers the two /health endpoints and the SponsorBlock 404. The other criteria have no test: `down` frees both ports, a second `down` exits 0, a taken port makes `up` exit 1 and leaves nothing running, and a second `up` starts from an empty D1 and R2. The only evidence for them is a manual run. The spec does not require a test for them, but a stack.sh regression would not be caught.

- **minor** (`e2e/playwright.config.ts:10`) Unused metadata.mocksUrl duplicates the URL built in the test

  The config sets metadata.mocksUrl, but the test builds the mocks URL again from MOCKS_PORT. Keep one source, for example an exported helper, before later tickets add more mocks routes.

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

  e2e/ is a Node 22 strict-TypeScript npm package with Playwright projects api and browser. mocks/server.ts runs with tsx and serves GET /health (200 {"status":"ok"}) and the SponsorBlock 404 'Not Found' (5.3; the Google routes are deferred to ticket 07 as the ticket says). stack.sh follows 5.1: it stops first, installs missing node_modules, wipes .stack/state, runs migrations with --persist-to, starts both processes under setsid and kills their process groups, exports WRANGLER_SEND_METRICS=false, checks /health on both ports for readiness, prints 'stack: ready $WORKER_URL', and exits 1 when a port is taken. Logs are truncated in .stack/logs. All 5.2 vars with their defaults go to the Worker as --var. e2e.sh matches 3.1 (npm ci, CI/non-CI Chromium install, LEASE_SECONDS=2, api-only fallback with the exact message, a trap that always stops the stack, and copying logs and the report into ci-artifacts on failure). lint is extended to e2e/, ci/jobs.json has the e2e job, and .stack/ is git-ignored. One small gap: the Google client defaults are not exported to the mocks server (minor finding).

- met: The change is covered by tests that fail without it.

  e2e/tests/stack.api.spec.ts checks the Worker /health, the mocks /health and the SponsorBlock 404. These tests cannot pass without the mocks server, stack.sh and e2e.sh, and the e2e check passed in Ariane's replay. The stack lifecycle criteria (port taken, double down, fresh state) have no automated test (minor finding).

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Five dated lines were added on 2026-10-16. They cover how tests are split between projects by file name, the reduced set of mocks routes, setsid with TERM then KILL after 5 s, port detection by connecting, passing every 5.2 setting as --var, and ignoring .wrangler/. Smaller defaults, like the 0.5 s poll interval and the HTML reporter, are implementation details rather than spec choices.

## Proposed learnings (not decided)

- When a spec says configuration is passed to several processes, check each process's environment, not only the Worker's --var list. Defaults applied inline with ${VAR:-default} are not exported to sibling processes.
- `setsid cmd &` from a non-interactive shell does not fork, so $! is the process group id and `kill -- -$pid` reaches the whole group. That is a valid way to meet 'stop the whole process group'.
- Lifecycle acceptance criteria of shell harnesses (port taken, idempotent down, fresh state) are often only checked by hand. Ask for evidence of the manual run, or for a small scripted test.
