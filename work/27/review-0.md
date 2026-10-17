# Review 0

- Reviewed commit: `651ae0b9f9fb4d30caf4c2aa6ac63fbce76aa5ae`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`worker/src/oauth.ts:326`) accepted_user_sub is set on a revoked invite row too

  `UPDATE invites SET accepted_user_sub = ? WHERE email = ?` has no `revoked = 0` filter. The admin is let in without an invite, so if the admin's e-mail also has a revoked invite, that revoked row gets marked as accepted. Spec 10.4 step 5 says 'the invite's accepted_user_sub is set', which means the invite that let the user in. Add `AND revoked = 0`, or record the choice in docs/decisions.md (the existing decision line only covers the case where there is no invite row).

- **minor** (`worker/tests/oauth.worker.test.ts:432`) No test checks the `email_unverified` and `google_error` log reasons

  The unverified-e-mail test checks the 403 status and that no users row is written, but not that `auth.oauth.denied` is logged with reason `email_unverified`. The server_error tests don't check reason `google_error` either. Section 14 asks for every rule to be covered by a test that fails without it, and the section 12 reason values are such rules.

- **minor** (`worker/src/oauth.ts:59`) Redirect URIs are checked after URL normalisation, not as written

  `validRedirectUri` parses the value with `new URL` and checks only the parsed protocol and host. A string like `https:client.test/cb` or `HTTP://localhost/cb` is accepted even though, as written, it is not an absolute `https://` URL. `/authorize` then compares redirect URIs by exact string match, so this does not open a redirect hole. Still, a client can register a URI that is not in the spec's literal form.

- **minor** (`worker/src/oauth.ts:242`) ID token details the spec leaves open are not written down

  The code accepts a JWK that has no `alg`, matches the key by `kid` only, ignores `iat`, and checks `iss` against `GOOGLE_ISSUER` exactly as configured, without the trailing-slash trimming used to build the discovery URL. Each is a reasonable simplest choice, but none of them is in docs/decisions.md.

- **minor** (`worker/src/env.d.ts:8`) Bindings that later tickets need are declared ahead of time

  `ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_SECONDS` and `ALLOWED_ORIGINS` are declared but nothing in this change uses them (they belong to /token and /mcp). The change is type-only and harmless, but it goes slightly beyond 'nothing more'.

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

  oauth.ts covers 10.1 (both protected-resource paths and the AS metadata, with the exact fields), 10.2 (validation order, invalid_redirect_uri / invalid_client_metadata, 201 body, client_id of 32 characters), 10.3 (a 400 HTML page for an unknown client or redirect URI and never a redirect, then the redirect errors in the spec's order, the escaped consent page with a form posting to /authorize/consent and the two decision buttons, deny returning access_denied, approve sending every Google parameter), 10.4 (the state is used up, a Google error gives access_denied, the exchange sends the secret in the body, the RS256/iss/aud/exp/nonce checks give server_error, admin/invite access control, the 403 'Access refused' page, users upsert, AES-GCM 'v1:' storage per 6.3, a hashed single-use code) and the three section 12 log events, with no e-mail, sub or tokens in log lines. It has no /token, /mcp, PATs or rate limiting. Unknown routes still fall through to notFound (6.1). The only extras are unused env typings (minor).

- met: The change is covered by tests that fail without it.

  worker/tests/oauth.worker.test.ts runs against real Miniflare D1 with a stubbed Google fetch. It covers each 10.2 error, the 10.3 errors and their order ('X before Y' cases), no redirect for a bad client or redirect_uri, escaping and the buttons on the consent page, deny/approve and every Google parameter, a bad/missing/used/expired state, a bad signature, aud, iss, nonce and exp, member and admin roles, a non-invited and a revoked invite getting 403 with no row, the refresh token absent from every table, and encrypt/decrypt with a random IV. The e2e tests add E2E-29 (api), the invited-user browser flow and E2E-02 (browser). All checks pass. Gaps: no test asserts the email_unverified or google_error log reasons (minor).

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Five new dated lines record: the flat OAuth error JSON; a non-object /register body; scope must be exactly 'digest'; an empty code_challenge counts as missing; the client_id format; an unknown decision gives 400 without using the request up; approving twice; the 502 when discovery fails; the denied reason mapping; no JWKS caching; keeping an existing refresh token; the admin without an invite. A few small ID-token details (optional JWK alg, iat ignored) and accepted_user_sub on revoked rows are not recorded (minor).

## Proposed learnings (not decided)

- When the admin can get in without an invite, scope every invite-row update to non-revoked rows, or say in docs/decisions.md why not.
- For each enumerated log `reason` value in section 12, assert it in the test of the path that emits it; asserting only the HTTP status leaves the log contract untested.
- Validate redirect URIs on the raw string as well as the parsed URL; URL normalisation can accept forms the spec does not describe.
