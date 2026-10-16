# Review 0

- Reviewed commit: `ebffb42b573c8bc74102db90acf65be0867c1ed5`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`worker/package.json:15`) @cloudflare/vitest-pool-workers is deprecated and brings its own wrangler and miniflare

  The lockfile marks @cloudflare/vitest-pool-workers 0.23.0 as deprecated (renamed to @cloudflare/vitest-plugin). It pins its own wrangler 4.124.0 and miniflare 5.20260815.0-alpha, while the top-level wrangler is 4.151.1 with miniflare 5.20261012.1-beta. So the tests run on a different (alpha) Miniflare from the one `wrangler dev` will use in the next ticket. This does not break anything now, but it is worth recording or moving to the renamed package.

- **minor** (`worker/src/ops.ts:43`) The Bearer scheme is matched case-sensitively

  `/^Bearer (.+)$/` rejects `bearer <token>`, although RFC 7235 auth schemes are case-insensitive. The behaviour is written down in docs/decisions.md ("non-`Bearer` header is a 401") and the spec writes `Bearer`, so it is acceptable. Later endpoints that use bearers (/node/*, /mcp) should behave the same way.

- **minor** (`worker/tests/worker.worker.test.ts:94`) The reset test's beforeEach only clears `nodes`

  The reset test relies on its own call to /ops/reset to clean up the rows it inserts into the other tables. If an assertion fails partway through, rows can be left behind for the other tests in the file. It is harmless now that it is the last describe block, but a full reset in beforeEach/afterEach would be sturdier.

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

  wrangler.toml has main, compatibility_date, D1 `DB` (yt-digest, migrations_dir=migrations), R2 `TRANSCRIPTS` (yt-digest-transcripts), and no account id or route (section 2). 0001_init.sql creates all ten tables of 6.3 with every listed column and hourly_budget default 60. index.ts serves GET /health with pkg.version and gives 404 not_found to everything else, using the 4.2 body and application/json (6.1/6.2). ops.ts gives 404 when OPS_TOKEN is empty or unset, 401 unauthorized before the body is read, compares the token in constant time over SHA-256 digests, and POST /ops/reset deletes from every table and pages through R2 deleting every object under `transcripts/`. No other routes were added; the mocks, stack.sh and e2e stay out, as the ticket says. 400 invalid_request has no body-taking route to apply to yet.

- met: The change is covered by tests that fail without it.

  tests/worker.worker.test.ts runs in the workers pool on Miniflare's real D1 and R2, with the migrations applied in tests/setup.ts. It checks: PRAGMA table_info for every table and column; the hourly_budget default; /health returning 200 with the package.json version; 404 not_found validated against error.schema.json for unknown routes and methods; 401 for a missing, wrong or non-Bearer header across several bodies; 404 when OPS_TOKEN is empty or unset; and reset emptying all ten tables and the transcripts/ prefix while keeping other prefixes. None of these routes or tables existed before, so every one of these tests fails without the change. test-worker passed in the replayed checks.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Five dated lines were added: the Vitest 4 pin and the projects split; the placeholder database_id and the compatibility_date; /ops/* auth covering unknown paths (401 before 404); the constant-time compare via SHA-256 digests, with a missing, empty or non-Bearer header giving 401; and the CHECK constraints plus the unique index on nodes.token_hash.

## Proposed learnings (not decided)

- With @cloudflare/vitest-pool-workers, apply the D1 migrations in a setupFile (readD1Migrations in the config, applyD1Migrations in setup) so worker tests hit real D1 instead of a fake.
- Check the pool's pinned wrangler and miniflare versions in the lockfile: they can differ from the top-level wrangler that `wrangler dev` uses.
- Authenticate /ops/* before routing, so an unauthenticated probe of an unknown path gets 401 and cannot discover which routes exist.
