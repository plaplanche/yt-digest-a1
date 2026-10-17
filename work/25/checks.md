# Checks

Replayed by Ariane on commit `68beb74416c19bb241ec8f6602e8e66f82705b5d`.

| Check | Blocking | Result | Duration |
| --- | --- | --- | --- |
| lint | yes | pass | 20.9 s |
| contracts | yes | pass | 18.8 s |
| test-node | yes | pass | 75.9 s |
| test-worker | yes | pass | 45.7 s |
| e2e | yes | pass | 23.3 s |

## lint

- Command: `./scripts/check.sh lint`
- Blocking: yes
- Result: passed (exit 0, 20.9 s)

```text
(48 earlier lines omitted)

added 209 packages, and audited 210 packages in 7s

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
- Result: passed (exit 0, 18.8 s)

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
- Result: passed (exit 0, 75.9 s)

```text
(17 earlier lines omitted)
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-9.1.1, pluggy-1.7.0
rootdir: /home/user/yt-digest-a1.ariane/worktrees/25-replay/node
configfile: pyproject.toml
plugins: typeguard-4.6.0, platformdirs-4.13.3
collected 135 items

node/tests/test_cli.py ...............                                   [ 11%]
node/tests/test_contracts.py ...........                                 [ 19%]
node/tests/test_daemon.py ............                                   [ 28%]
node/tests/test_extractors.py ......................                     [ 44%]
node/tests/test_log.py .......                                           [ 49%]
node/tests/test_node_contracts.py .......................                [ 66%]
node/tests/test_pages.py ........                                        [ 72%]
node/tests/test_placeholder.py .                                         [ 73%]
node/tests/test_sponsorblock.py .........................                [ 91%]
node/tests/test_vtt.py ...........                                       [100%]

======================== 135 passed in 67.60s (0:01:07) ========================
```

## test-worker

- Command: `./scripts/check.sh test-worker`
- Blocking: yes
- Result: passed (exit 0, 45.7 s)

```text
(13 earlier lines omitted)
Run `npm audit` for details.
[33m▲ [43;33m[[43;30mWARNING[43;33m][0m [1mProxy environment variables detected. We'll use your proxy for fetch requests.[0m



=======================================================================================
WARNING: @cloudflare/vitest-pool-workers has been renamed to @cloudflare/vitest-plugin.
This package will not receive future updates.
Run `npx @cloudflare/codemods vitest:pool-workers-to-vitest-plugin` to migrate.
=======================================================================================


 RUN  v4.1.12 /home/user/yt-digest-a1.ariane/worktrees/25-replay/worker


 Test Files  9 passed (9)
      Tests  135 passed (135)
   Start at  00:45:25
   Duration  35.05s (transform 901ms, setup 2.58s, import 1.39s, tests 37.93s, environment 0ms)
```

## e2e

- Command: `./scripts/check.sh e2e`
- Blocking: yes
- Result: passed (exit 0, 23.3 s)

```text
(49 earlier lines omitted)
  ✓   1 [api] › tests/claims.api.spec.ts:16:1 › 2 nodes claim 6 jobs concurrently: each job is handed out once (570ms)
  ✓   2 [api] › tests/daemon.api.spec.ts:16:1 › yt-digest-node work --once processes a queued video and its transcript is readable (505ms)
  ✓   3 [api] › tests/google.api.spec.ts:26:1 › the discovery document (15ms)
  ✓   4 [api] › tests/google.api.spec.ts:42:1 › authorize refuses a wrong client_id and a missing openid scope (27ms)
  ✓   5 [api] › tests/google.api.spec.ts:48:1 › authorize without login_hint shows a form repeating every parameter (19ms)
  ✓   6 [api] › tests/google.api.spec.ts:61:1 › the code gives an ID token signed with the JWKS key (36ms)
  ✓   7 [api] › tests/google.api.spec.ts:87:1 › the code is single use and bound to its redirect_uri (32ms)
  ✓   8 [api] › tests/google.api.spec.ts:98:1 › a wrong client secret gives 401 invalid_client; Basic authentication works (25ms)
  ✓   9 [api] › tests/google.api.spec.ts:109:1 › access_type=offline gives a refresh token that yields new tokens (32ms)
  ✓  10 [api] › tests/google.api.spec.ts:123:1 › userinfo answers for its access token only (20ms)
  ✓  11 [api] › tests/google.api.spec.ts:133:1 › revoke answers 200 (7ms)
  ✓  12 [api] › tests/leases.api.spec.ts:34:1 › E2E-14: an expired lease goes to another node and the late result gets 409 (2.8s)
  ✓  13 [api] › tests/leases.api.spec.ts:51:1 › E2E-16: unavailable on 3 nodes gives failed_video and a 4th node gets nothing (179ms)
  ✓  14 [api] › tests/leases.api.spec.ts:63:1 › E2E-20: a revoked node is refused and its job reassigned (120ms)
  ✓  15 [api] › tests/leases.api.spec.ts:78:1 › E2E-21: /node/* responses hold no user data (114ms)
  ✓  16 [api] › tests/stack.api.spec.ts:5:1 › the Worker answers /health (11ms)
  ✓  17 [api] › tests/stack.api.spec.ts:11:1 › the mocks server answers /health (8ms)
  ✓  18 [api] › tests/stack.api.spec.ts:17:1 › SponsorBlock has no segment for any video (10ms)

  18 passed (5.7s)
```

Summary: 5 passed, 0 failed (0 blocking).
