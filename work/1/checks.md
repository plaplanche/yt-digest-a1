# Checks

Replayed by Ariane on commit `ba00e586a8d123713ea0ba0606187393d2df51ed`.

| Check | Blocking | Result | Duration |
| --- | --- | --- | --- |
| lint | yes | pass | 5.3 s |
| contracts | yes | pass | 0.0 s |
| test-node | yes | pass | 0.6 s |
| test-worker | yes | pass | 3.2 s |

## lint

- Command: `./scripts/check.sh lint`
- Blocking: yes
- Result: passed (exit 0, 5.3 s)

```text
(20 earlier lines omitted)
 + ruff==0.17.1
 + typing-extensions==4.16.0
 + yt-digest-node==0.1.0 (from file:///home/user/yt-digest-a1.ariane/worktrees/1-replay/node)
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
warning: `VIRTUAL_ENV=/home/user/ariane/.venv` does not match the project environment path `node/.venv` and will be ignored; use `--active` to target the active environment instead
All checks passed!
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
warning: `VIRTUAL_ENV=/home/user/ariane/.venv` does not match the project environment path `node/.venv` and will be ignored; use `--active` to target the active environment instead
2 files already formatted
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
warning: `VIRTUAL_ENV=/home/user/ariane/.venv` does not match the project environment path `.venv` and will be ignored; use `--active` to target the active environment instead
Success: no issues found in 2 source files

added 131 packages, and audited 132 packages in 2s

41 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
```

## contracts

- Command: `./scripts/check.sh contracts`
- Blocking: yes
- Result: passed (exit 0, 0.0 s)

```text
== contracts
no scripts/contracts.sh yet: nothing to check
```

## test-node

- Command: `./scripts/check.sh test-node`
- Blocking: yes
- Result: passed (exit 0, 0.6 s)

```text
== test-node
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
warning: `VIRTUAL_ENV=/home/user/ariane/.venv` does not match the project environment path `node/.venv` and will be ignored; use `--active` to target the active environment instead
Resolved 14 packages in 1ms
Checked 13 packages in 0.19ms
warning: The `UV_NATIVE_TLS` environment variable is deprecated and will be removed in a future release. Use `UV_SYSTEM_CERTS` instead.
warning: `VIRTUAL_ENV=/home/user/ariane/.venv` does not match the project environment path `node/.venv` and will be ignored; use `--active` to target the active environment instead
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-9.1.1, pluggy-1.7.0
rootdir: /home/user/yt-digest-a1.ariane/worktrees/1-replay/node
configfile: pyproject.toml
collected 1 item

node/tests/test_placeholder.py .                                         [100%]

============================== 1 passed in 0.01s ===============================
```

## test-worker

- Command: `./scripts/check.sh test-worker`
- Blocking: yes
- Result: passed (exit 0, 3.2 s)

```text
== test-worker

added 131 packages, and audited 132 packages in 2s

41 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities

 RUN  v5.0.5 /home/user/yt-digest-a1.ariane/worktrees/1-replay/worker


 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  19:00:44
   Duration  224ms (transform 60%, import 24%, worker 10%, tests 6%)
```

Summary: 4 passed, 0 failed (0 blocking).
