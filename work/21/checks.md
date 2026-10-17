# Checks

Replayed by Ariane on commit `b25bce7ce312af9a4b65750f29faba7bf59307a9`.

| Check | Blocking | Result | Duration |
| --- | --- | --- | --- |
| lint | yes | pass | 20.4 s |
| contracts | yes | pass | 17.8 s |
| test-node | yes | pass | 68.4 s |
| test-worker | yes | pass | 43.5 s |
| e2e | yes | pass | 20.5 s |

## lint

- Command: `./scripts/check.sh lint`
- Blocking: yes
- Result: passed (exit 0, 20.4 s)

```text
(48 earlier lines omitted)

added 209 packages, and audited 210 packages in 7s

69 packages are looking for funding
  run `npm fund` for details

5 high severity vulnerabilities

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.

added 104 packages, and audited 105 packages in 1s

30 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
```

## contracts

- Command: `./scripts/check.sh contracts`
- Blocking: yes
- Result: passed (exit 0, 17.8 s)

```text
(5 earlier lines omitted)
69 packages are looking for funding
  run `npm fund` for details

5 high severity vulnerabilities

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
generated files are up to date
```

## test-node

- Command: `./scripts/check.sh test-node`
- Blocking: yes
- Result: passed (exit 0, 68.4 s)

```text
(16 earlier lines omitted)
Run `npm audit` for details.
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-9.1.1, pluggy-1.7.0
rootdir: /home/user/yt-digest-a1.ariane/worktrees/21-replay/node
configfile: pyproject.toml
plugins: typeguard-4.6.0, platformdirs-4.13.3
collected 123 items

node/tests/test_cli.py ...............                                   [ 12%]
node/tests/test_contracts.py ...........                                 [ 21%]
node/tests/test_extractors.py ......................                     [ 39%]
node/tests/test_log.py .......                                           [ 44%]
node/tests/test_node_contracts.py .......................                [ 63%]
node/tests/test_pages.py ........                                        [ 69%]
node/tests/test_placeholder.py .                                         [ 70%]
node/tests/test_sponsorblock.py .........................                [ 91%]
node/tests/test_vtt.py ...........                                       [100%]

======================== 123 passed in 60.11s (0:01:00) ========================
```

## test-worker

- Command: `./scripts/check.sh test-worker`
- Blocking: yes
- Result: passed (exit 0, 43.5 s)

```text
(13 earlier lines omitted)
Run `npm audit` for details.
[33m▲ [43;33m[[43;30mWARNING[43;33m][0m [1mProxy environment variables detected. We'll use your proxy for fetch requests.[0m



=======================================================================================
WARNING: @cloudflare/vitest-pool-workers has been renamed to @cloudflare/vitest-plugin.
This package will not receive future updates.
Run `npx @cloudflare/codemods vitest:pool-workers-to-vitest-plugin` to migrate.
=======================================================================================


 RUN  v4.1.12 /home/user/yt-digest-a1.ariane/worktrees/21-replay/worker


 Test Files  8 passed (8)
      Tests  129 passed (129)
   Start at  00:04:55
   Duration  32.64s (transform 681ms, setup 1.65s, import 1.06s, tests 34.52s, environment 0ms)
```

## e2e

- Command: `./scripts/check.sh e2e`
- Blocking: yes
- Result: passed (exit 0, 20.5 s)

```text
(39 earlier lines omitted)
Error: Failed to download Chrome for Testing 156.0.8078.4 (playwright chromium v1248), caused by
Error: Download failure, code=1
    at ChildProcess.<anonymous> (/home/user/yt-digest-a1.ariane/worktrees/21-replay/e2e/node_modules/playwright-core/lib/coreBundle.js:33774:32)
    at ChildProcess.emit (node:events:519:28)
    at ChildProcess._handle.onexit (node:internal/child_process:293:12)
e2e: chromium unavailable, browser project skipped
stack: ready http://127.0.0.1:8787

Running 8 tests using 1 worker

  ✓  1 [api] › tests/claims.api.spec.ts:16:1 › 2 nodes claim 6 jobs concurrently: each job is handed out once (474ms)
  ✓  2 [api] › tests/leases.api.spec.ts:34:1 › E2E-14: an expired lease goes to another node and the late result gets 409 (2.4s)
  ✓  3 [api] › tests/leases.api.spec.ts:51:1 › E2E-16: unavailable on 3 nodes gives failed_video and a 4th node gets nothing (191ms)
  ✓  4 [api] › tests/leases.api.spec.ts:63:1 › E2E-20: a revoked node is refused and its job reassigned (116ms)
  ✓  5 [api] › tests/leases.api.spec.ts:78:1 › E2E-21: /node/* responses hold no user data (108ms)
  ✓  6 [api] › tests/stack.api.spec.ts:5:1 › the Worker answers /health (10ms)
  ✓  7 [api] › tests/stack.api.spec.ts:11:1 › the mocks server answers /health (7ms)
  ✓  8 [api] › tests/stack.api.spec.ts:17:1 › SponsorBlock has no segment for any video (6ms)

  8 passed (4.2s)
```

Summary: 5 passed, 0 failed (0 blocking).
