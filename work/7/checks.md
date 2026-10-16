# Checks

Replayed by Ariane on commit `992e781229eba1e3f1425349b1c338339ae94bf2`.

| Check | Blocking | Result | Duration |
| --- | --- | --- | --- |
| lint | yes | pass | 8.2 s |
| contracts | yes | pass | 5.2 s |
| test-node | yes | pass | 28.1 s |
| test-worker | yes | pass | 13.2 s |

## lint

- Command: `./scripts/check.sh lint`
- Blocking: yes
- Result: passed (exit 0, 8.2 s)

```text
(34 earlier lines omitted)
 + pyyaml==6.0.3
 + ruff==0.17.1
 + typeguard==4.6.0
 + typing-extensions==4.16.0
 + typing-inspection==0.4.4
 + yt-digest-node==0.1.0 (from file:///home/user/yt-digest-a1.ariane/worktrees/7-replay/node)
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
All checks passed!
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
12 files already formatted
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
Success: no issues found in 12 source files

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
- Result: passed (exit 0, 28.1 s)

```text
(6 earlier lines omitted)

49 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-9.1.1, pluggy-1.7.0
rootdir: /home/user/yt-digest-a1.ariane/worktrees/7-replay/node
configfile: pyproject.toml
plugins: typeguard-4.6.0, platformdirs-4.13.3
collected 54 items

node/tests/test_contracts.py ...........                                 [ 20%]
node/tests/test_log.py ......                                            [ 31%]
node/tests/test_placeholder.py .                                         [ 33%]
node/tests/test_sponsorblock.py .........................                [ 79%]
node/tests/test_vtt.py ...........                                       [100%]

============================= 54 passed in 24.19s ==============================
```

## test-worker

- Command: `./scripts/check.sh test-worker`
- Blocking: yes
- Result: passed (exit 0, 13.2 s)

```text
== test-worker

added 146 packages, and audited 147 packages in 3s

49 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities

 RUN  v5.0.5 /home/user/yt-digest-a1.ariane/worktrees/7-replay/worker


 Test Files  4 passed (4)
      Tests  12 passed (12)
   Start at  19:59:41
   Duration  9.42s (tests 95%, import 3%, transform 2%)
```

Summary: 4 passed, 0 failed (0 blocking).
