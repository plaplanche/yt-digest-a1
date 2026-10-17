# Review 0

- Reviewed commit: `68beb74416c19bb241ec8f6602e8e66f82705b5d`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`worker/src/ops.ts:113`) Re-invite behaviour on invited_at / accepted_user_sub is an undocumented choice

  `ON CONFLICT (email) DO UPDATE SET revoked = 0` keeps the original `invited_at` and any `accepted_user_sub` when a revoked invite is re-activated. The spec says only that inviting again re-activates the invite, so keeping these columns is an open choice. It is not written down in docs/decisions.md; the new decision line for invites covers only revoke.

- **minor** (`e2e/mocks/server.ts:95`) Malformed Basic credentials give 500 instead of 401 invalid_client

  `decodeURIComponent` throws on an invalid percent-sequence (e.g. `Basic base64("a%:b")`). The outer catch then answers 500 text/plain. Spec 5.3 expects a wrong client pair to give 401 `{"error":"invalid_client"}`. This is test-only infrastructure, so it is not blocking, but wrapping the decode in try/catch and treating a failure as unauthenticated would match the spec.

- **minor** (`e2e/tests/google.api.spec.ts:86`) Code lifetime (60 s) and token expiry are not exercised

  Single use and redirect_uri binding are tested, but nothing checks the 60-second code validity from 5.3. The acceptance criteria don't require it, so this is coverage feedback only.

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

  e2e/mocks/server.ts adds every 5.3 route with the specified behaviour: discovery fields, authorize checks returning 400 plain text, the sign-in form repeating all parameters, a 302 with code and state, a 60 s single-use code, body or Basic client auth with 401 invalid_client, both grants, refresh_token only with access_type=offline, an RS256 ID token with the JWKS kid, a lowercased email, the subject rule, nonce, exp = iat + 3600, userinfo, JWKS and revoke 200. The sponsorblock route still answers 404 'Not Found' through the default branch. worker/src/ops.ts adds POST /ops/invites (lowercased, upsert re-activating), POST /ops/invites/revoke (404 not_found when unknown) and GET /ops/users (ORDER BY email), after the existing operator auth. The schema in migrations/0001_init.sql matches 6.3. No Worker OAuth or /mcp routes were added, which keeps the change out of the excluded scope.

- met: The change is covered by tests that fail without it.

  e2e/tests/google.api.spec.ts (matched by the `api` project regex /.*\.api\.spec\.ts/) covers every e2e acceptance criterion: discovery, 400 on a wrong client_id or a missing openid scope, the form repeating parameters, the login_hint redirect with code and state, the ID token verified against the JWKS key with the full claim set, single use, 401 invalid_client, and userinfo for its own token only. worker/tests/invites.worker.test.ts covers the lowercased store, re-activation, 404 not_found on an unknown revoke, and users sorted by email. All of these routes answered 404 before the change, so the tests would fail without it. All checks are reported green.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Three dated lines cover an empty login_hint, a code consumed on a failed exchange, no refresh rotation, no nonce on refresh, the token-response scope, access/refresh token lifetimes, and revoke semantics (row kept, lowercased lookup, 400 on a non-string email). One small gap: the re-invite keeps invited_at and accepted_user_sub without a decision line (minor finding).

## Proposed learnings (not decided)

- When an upsert re-activates a row, record in docs/decisions.md which other columns (timestamps, links) are kept or reset.
- Guard decodeURIComponent on externally supplied credentials: a malformed value should map to the protocol's auth error, not a 500.
- A mocks route removed from the switch can still be spec-compliant through the default 404 branch; check the body and content type match before flagging it.
