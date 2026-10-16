# Checks

Replayed by Ariane on commit `06d4746b887f16c2d55fcf057776b504880f1b3c`.

| Check | Blocking | Result | Duration |
| --- | --- | --- | --- |
| lint | yes | pass | 8.2 s |
| contracts | yes | pass | 5.1 s |
| test-node | yes | pass | 32.7 s |
| test-worker | yes | pass | 13.9 s |

## lint

- Command: `./scripts/check.sh lint`
- Blocking: yes
- Result: passed (exit 0, 8.2 s)

```text
(35 earlier lines omitted)
 + ruff==0.17.1
 + typeguard==4.6.0
 + typing-extensions==4.16.0
 + typing-inspection==0.4.4
 + yt-digest-node==0.1.0 (from file:///home/user/yt-digest-a1.ariane/worktrees/11-replay/node)
 + yt-dlp==2026.8.19
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
All checks passed!
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
18 files already formatted
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
Success: no issues found in 18 source files

added 146 packages, and audited 147 packages in 2s

49 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
```

## contracts

- Command: `./scripts/check.sh contracts`
- Blocking: yes
- Result: passed (exit 0, 5.1 s)

```text
== contracts

added 146 packages, and audited 147 packages in 3s

49 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
generated files are up to date
```

## test-node

- Command: `./scripts/check.sh test-node`
- Blocking: yes
- Result: passed (exit 0, 32.7 s)

```text
(9 earlier lines omitted)

found 0 vulnerabilities
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-9.1.1, pluggy-1.7.0
rootdir: /home/user/yt-digest-a1.ariane/worktrees/11-replay/node
configfile: pyproject.toml
plugins: typeguard-4.6.0, platformdirs-4.13.3
collected 99 items

node/tests/test_cli.py ...............                                   [ 15%]
node/tests/test_contracts.py ...........                                 [ 26%]
node/tests/test_extractors.py ......................                     [ 48%]
node/tests/test_log.py ......                                            [ 54%]
node/tests/test_pages.py ........                                        [ 62%]
node/tests/test_placeholder.py .                                         [ 63%]
node/tests/test_sponsorblock.py .........................                [ 88%]
node/tests/test_vtt.py ...........                                       [100%]

============================= 99 passed in 28.78s ==============================
```

## test-worker

- Command: `./scripts/check.sh test-worker`
- Blocking: yes
- Result: passed (exit 0, 13.9 s)

```text
== test-worker

added 146 packages, and audited 147 packages in 3s

49 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities

 RUN  v5.0.5 /home/user/yt-digest-a1.ariane/worktrees/11-replay/worker


 Test Files  4 passed (4)
      Tests  12 passed (12)
   Start at  20:25:50
   Duration  9.69s (tests 95%, import 3%, transform 2%)
```

Summary: 4 passed, 0 failed (0 blocking).
