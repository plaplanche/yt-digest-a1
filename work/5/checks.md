# Checks

Replayed by Ariane on commit `d5842e649f009f6bcfc793c1f96e45e154c0f737`.

| Check | Blocking | Result | Duration |
| --- | --- | --- | --- |
| lint | yes | pass | 8.1 s |
| contracts | yes | pass | 5.2 s |
| test-node | yes | pass | 15.7 s |
| test-worker | yes | pass | 12.8 s |

## lint

- Command: `./scripts/check.sh lint`
- Blocking: yes
- Result: passed (exit 0, 8.1 s)

```text
(34 earlier lines omitted)
 + pyyaml==6.0.3
 + ruff==0.17.1
 + typeguard==4.6.0
 + typing-extensions==4.16.0
 + typing-inspection==0.4.4
 + yt-digest-node==0.1.0 (from file:///home/user/yt-digest-a1.ariane/worktrees/5-replay/node)
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
All checks passed!
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
10 files already formatted
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
Success: no issues found in 10 source files

added 146 packages, and audited 147 packages in 2s

49 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
```

## contracts

- Command: `./scripts/check.sh contracts`
- Blocking: yes
- Result: passed (exit 0, 5.2 s)

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
- Result: passed (exit 0, 15.7 s)

```text
(5 earlier lines omitted)
added 146 packages, and audited 147 packages in 3s

49 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-9.1.1, pluggy-1.7.0
rootdir: /home/user/yt-digest-a1.ariane/worktrees/5-replay/node
configfile: pyproject.toml
plugins: typeguard-4.6.0, platformdirs-4.13.3
collected 29 items

node/tests/test_contracts.py ...........                                 [ 37%]
node/tests/test_log.py ......                                            [ 58%]
node/tests/test_placeholder.py .                                         [ 62%]
node/tests/test_vtt.py ...........                                       [100%]

============================= 29 passed in 11.67s ==============================
```

## test-worker

- Command: `./scripts/check.sh test-worker`
- Blocking: yes
- Result: passed (exit 0, 12.8 s)

```text
== test-worker

added 146 packages, and audited 147 packages in 3s

49 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities

 RUN  v5.0.5 /home/user/yt-digest-a1.ariane/worktrees/5-replay/worker


 Test Files  4 passed (4)
      Tests  12 passed (12)
   Start at  19:47:04
   Duration  9.24s (tests 95%, import 3%, transform 2%)
```

Summary: 4 passed, 0 failed (0 blocking).
