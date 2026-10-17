# Review 0

- Reviewed commit: `69ddc5d25fc379cd088e400e5246b25335c4f28e`
- Reviewer model: claude-opus-5-5
- Verdict: **no-go** (the reviewer answered no-go)

## Findings

- **blocking** (`worker/tests/token.worker.test.ts:1`) The new log events auth.token.issued and auth.refresh.reuse_detected are not tested

  The ticket's decided spec includes the log events of section 12: `auth.token.issued` {client_id, grant_type} and `auth.refresh.reuse_detected` {client_id, revoked}, at level warn per the decision. No test checks that they are emitted, or checks their attrs, or checks that no token appears in the line. The log schema only checks the event name and the common fields, so a test still passes if a `log(...)` call is removed or the `revoked` count is wrong. The project already tests logs this way (see oauth.worker.test.ts:196 and :500, which use `vi.spyOn(console, "error")`). Add tests that spy on console.error for one issue by each grant and for one reuse, checking `revoked` (e.g. 4 after one rotation) and that no token is in the line.

- **minor** (`worker/src/token.ts:131`) Content-Type check uses startsWith

  `startsWith("application/x-www-form-urlencoded")` also accepts types such as `application/x-www-form-urlencoded-foo`. Parsing the media type before any `;` would be stricter. Low impact.

- **minor** (`worker/src/token.ts:34`) Code use-up and token issue are not atomic

  The code (or the refresh token) is marked used in one statement, and the tokens are inserted in a later batch. If the insert fails, the client loses its code, or its refresh token, which then looks like a reuse on retry and revokes the family. The spec allows this, but rotation could put the UPDATE in the same batch as the inserts.

- **minor** (`worker/tests/token.worker.test.ts:155`) ACCESS_TOKEN_TTL_SECONDS is never set to a non-default value

  `expires_in: 3600` is checked, but only against the default, so a test would still pass if the code ignored `env.ACCESS_TOKEN_TTL_SECONDS`. A test with the variable overridden would close this gap.

- **blocking** Definition of done not met: The change is covered by tests that fail without it.

  Worker tests cover every 10.5 error, the code used up by a failed exchange, no-store, rotation, reuse and family revocation, and the 10.6 cases (valid, expired, revoked, refresh, node, revoked invite, wrong resource). e2e/tests/token.api.spec.ts covers E2E-31 over HTTP with login_hint. But the log events auth.token.issued and auth.refresh.reuse_detected, part of the ticket's decided spec, have no test, and a non-default ACCESS_TOKEN_TTL_SECONDS is never exercised.

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

  token.ts follows 10.5: form-encoded only, check order grant type → client → missing params → resource → code, the code used up before the code checks (UPDATE … RETURNING), PKCE S256, single-use codes, rotation within the family, reuse revokes the whole family and logs reuse_detected, Cache-Control: no-store, expires_in from ACCESS_TOKEN_TTL_SECONDS. checkAccessToken follows 10.6: kind access, resource BASE/mcp, expiry and revocation, admission read again each call (ADMIN_EMAIL or a non-revoked invite). /mcp is not touched. The TTL variables are already passed by stack.sh.

- **not met**: The change is covered by tests that fail without it.

  Worker tests cover every 10.5 error, the code used up by a failed exchange, no-store, rotation, reuse and family revocation, and the 10.6 cases (valid, expired, revoked, refresh, node, revoked invite, wrong resource). e2e/tests/token.api.spec.ts covers E2E-31 over HTTP with login_hint. But the log events auth.token.issued and auth.refresh.reuse_detected, part of the ticket's decided spec, have no test, and a non-default ACCESS_TOKEN_TTL_SECONDS is never exercised.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Three dated lines were added: the Content-Type rule, empty means missing, a missing grant_type or client_id; reuse when the token is expired or the family is already revoked, a foreign client's token, no admission re-check on refresh; the checkAccessToken reasons and that /mcp logs the rejection.

## Proposed learnings (not decided)

- When a ticket adds log events from section 12, test each one with a console.error spy: check the event, its attrs, and that no secret is in the line. The log schema only checks the event name, not the per-event attrs.
- Test configurable TTLs with a non-default value, so the env variable is shown to be read rather than the default being hard-coded.
