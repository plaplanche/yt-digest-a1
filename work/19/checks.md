# Checks

Replayed by Ariane on commit `763ebd2e7bd1cd10a4318ae61bc349596de32278`.

| Check | Blocking | Result | Duration |
| --- | --- | --- | --- |
| lint | yes | pass | 18.3 s |
| contracts | yes | pass | 17.3 s |
| test-node | yes | pass | 74.4 s |
| test-worker | yes | pass | 44.8 s |
| e2e | yes | pass | 17.3 s |

## lint

- Command: `./scripts/check.sh lint`
- Blocking: yes
- Result: passed (exit 0, 18.3 s)

```text
(48 earlier lines omitted)

added 209 packages, and audited 210 packages in 6s

69 packages are looking for funding
  run `npm fund` for details

5 high severity vulnerabilities

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.

added 104 packages, and audited 105 packages in 2s

30 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
```

## contracts

- Command: `./scripts/check.sh contracts`
- Blocking: yes
- Result: passed (exit 0, 17.3 s)

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
- Result: passed (exit 0, 74.4 s)

```text
(16 earlier lines omitted)
Run `npm audit` for details.
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-9.1.1, pluggy-1.7.0
rootdir: /home/user/yt-digest-a1.ariane/worktrees/19-replay/node
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

======================== 123 passed in 66.58s (0:01:06) ========================
```

## test-worker

- Command: `./scripts/check.sh test-worker`
- Blocking: yes
- Result: passed (exit 0, 44.8 s)

```text
(13 earlier lines omitted)
Run `npm audit` for details.
[33m▲ [43;33m[[43;30mWARNING[43;33m][0m [1mProxy environment variables detected. We'll use your proxy for fetch requests.[0m



=======================================================================================
WARNING: @cloudflare/vitest-pool-workers has been renamed to @cloudflare/vitest-plugin.
This package will not receive future updates.
Run `npx @cloudflare/codemods vitest:pool-workers-to-vitest-plugin` to migrate.
=======================================================================================


 RUN  v4.1.12 /home/user/yt-digest-a1.ariane/worktrees/19-replay/worker


 Test Files  7 passed (7)
      Tests  99 passed (99)
   Start at  23:47:06
   Duration  33.96s (transform 525ms, setup 937ms, import 967ms, tests 34.30s, environment 0ms)
```

## e2e

- Command: `./scripts/check.sh e2e`
- Blocking: yes
- Result: passed (exit 0, 17.3 s)

```text
(35 earlier lines omitted)
    at IncomingMessage.emit (node:events:531:35)
    at endReadableNT (node:internal/streams/readable:1698:12)
    at process.processTicksAndRejections (node:internal/process/task_queues:90:21)
Failed to install browsers
Error: Failed to download Chrome for Testing 156.0.8078.4 (playwright chromium v1248), caused by
Error: Download failure, code=1
    at ChildProcess.<anonymous> (/home/user/yt-digest-a1.ariane/worktrees/19-replay/e2e/node_modules/playwright-core/lib/coreBundle.js:33774:32)
    at ChildProcess.emit (node:events:519:28)
    at ChildProcess._handle.onexit (node:internal/child_process:293:12)
e2e: chromium unavailable, browser project skipped
stack: ready http://127.0.0.1:8787

Running 4 tests using 2 workers

  ✓  2 [api] › tests/stack.api.spec.ts:5:1 › the Worker answers /health (44ms)
  ✓  3 [api] › tests/stack.api.spec.ts:11:1 › the mocks server answers /health (13ms)
  ✓  4 [api] › tests/stack.api.spec.ts:17:1 › SponsorBlock has no segment for any video (20ms)
  ✓  1 [api] › tests/claims.api.spec.ts:16:1 › 2 nodes claim 6 jobs concurrently: each job is handed out once (267ms)

  4 passed (1.1s)
```

Summary: 5 passed, 0 failed (0 blocking).
