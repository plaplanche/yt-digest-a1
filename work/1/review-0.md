# Review 0

- Reviewed commit: `ba00e586a8d123713ea0ba0606187393d2df51ed`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`scripts/checks/contracts.sh:4`) Contracts gate silently passes if scripts/contracts.sh exists but is not executable

  The test is `-x`, so if a later ticket commits scripts/contracts.sh without the exec bit, the check prints 'nothing to check' and passes. The contracts gate would disappear without anyone noticing. Test `-e` instead and run the script, so a missing exec bit makes the check fail loudly.

- **minor** (`worker/tsconfig.json:9`) @types/node is installed but disabled by "types": []

  package.json adds @types/node as a dev dependency, but tsconfig sets `types: []`, so it is never loaded. Either the dependency is unneeded (outside the ticket's scope) or the config is wrong. @eslint/js is also declared but never imported in eslint.config.js. Remove the unused dependencies or use them.

- **minor** (`docs/decisions.md:1`) Some open choices are not recorded

  Python is pinned to 3.12 only, but worker/package.json uses `engines.node: ">=22"` with no recorded rationale for the asymmetry. Other unrecorded choices: the tsconfig module settings (target ES2022, module ESNext, moduleResolution Bundler, `types: []`) and using ruff's default rule set with no [tool.ruff] config. Each is cheap to add as one dated line.

- **minor** (`work/1/journal.md:10`) No recorded evidence of the lint-failure demonstrations

  The acceptance criterion asks to show `./scripts/check.sh lint` failing on a Python lint error, a type error, a TypeScript error and a shellcheck warning. The journal stops at Setup and records none of this. By construction the script should catch all four: ruff default F rules, mypy --strict, tsc --noEmit over src and tests, and shellcheck on every scripts/*.sh, each under `set -euo pipefail`. Still, the demonstration should be logged in the journal or the PR.

## Definition of done

- met: check lint passes

  Replayed by Ariane: exit 0.

- met: check contracts passes

  Replayed by Ariane: exit 0.

- met: check test-node passes

  Replayed by Ariane: exit 0.

- met: check test-worker passes

  Replayed by Ariane: exit 0.

- met: The change does what the ticket and spec/lot-1.md say, and nothing more.

  node/ is a uv project for Python 3.12 with hatchling, a src/yt_digest_node layout, ruff, mypy and pytest dev deps, a committed uv.lock and one placeholder test. worker/ is an ESM npm package with TypeScript strict, ESLint and Vitest, a committed package-lock.json and one placeholder test. The four scripts/checks/*.sh are executable (mode 100755) and match section 3.1: ruff check, ruff format --check, mypy --strict, tsc --noEmit, eslint, and `uvx --from shellcheck-py shellcheck` on scripts/**/*.sh. Each script installs its own deps (uv sync --locked, npm ci), and contracts falls back when there is nothing to check. ci/jobs.json already has one job per check, and spec/, .github/workflows/ and check.sh are untouched. Small extras: .gitignore, npm scripts, and the unused @eslint/js and @types/node.

- met: The change is covered by tests that fail without it.

  All four checks pass (replayed: lint, contracts, test-node, test-worker). node/tests/test_placeholder.py imports yt_digest_node, so it fails without the package. The worker test is a pure placeholder, as the ticket asks. For this ticket the checks themselves are the deliverable, and they run in CI. The lint-failure demonstrations are not recorded (see the minor finding).

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  docs/decisions.md records four dated choices: the Python pin and hatchling, the ESLint flat config with ESM and tsc noEmit, running mypy from node/ with shellcheck scope, and the contracts fallback. Remaining gaps are small: the Node engines range, the tsconfig module settings, and ruff's default rule set (see the minor finding).

## Proposed learnings (not decided)

- When a check script is guarded on an optional file, use `-e` and then run it. With `-x`, a missing exec bit silently turns the gate off.
- Keep tsconfig `types` and the @types/* dev dependencies consistent; `types: []` makes @types/node dead weight.
- For scaffolding tickets whose acceptance criteria require showing failures with throwaway changes, record each demonstration (command and failing output) in the journal or PR so the reviewer can check it.
