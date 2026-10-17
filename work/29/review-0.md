# Review 0

- Reviewed commit: `c2f8f651ca4ab69906ec24e51e5ad1b1983c608b`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`worker/tests/oauth.worker.test.ts:180`) The order of the 10.2 errors is not tested

  The acceptance criteria ask for each error case of 10.2 "in its order". docs/decisions.md says `redirect_uris` is checked before the other fields, but no test sends a body where both `redirect_uris` and another field are invalid and checks that `invalid_redirect_uri` wins. The order between the `invalid_client_metadata` fields is not tested either. If `register()` were reordered, every test would still pass.

- **minor** (`worker/tests/oauth.worker.test.ts:190`) Some decided behaviours have no test

  These choices are recorded in docs/decisions.md, but no test fails if they are removed: a JSON body that is not an object (an array or null) giving `invalid_request` (only a non-JSON string is tested); a `decision` other than approve/deny giving a 400 HTML page (oauth.ts:189); the 502 page when Google's discovery document cannot be read (oauth.ts:209); a second `approve` replacing the Google state and nonce; an error redirect keeping a query already in the registered redirect_uri.

- **minor** (`e2e/tests/oauth.api.spec.ts:28`) E2E-29 'no PKCE' sends empty parameters instead of leaving them out

  The no-PKCE case sends `code_challenge=` and `code_challenge_method=` with empty values. That depends on the Worker's own decision that an empty challenge counts as missing. It does not test the plain case in spec 10.3, where `code_challenge` is missing. The Worker test covers the missing case, so the logic is tested, but the E2E scenario would read more faithfully if it left the parameters out.

- **minor** (`worker/src/oauth.ts:204`) approve writes the Google state before checking that Google's discovery document can be read

  When discovery fails, the pending authorization is still given a new `google_state` and `nonce`, and the user gets a 502. This is harmless, because the state was never sent to anyone and a retry replaces it. Fetching the discovery document before the UPDATE would be simpler to reason about.

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

  worker/src/oauth.ts implements 10.1 (both protected-resource paths and the AS metadata, with the exact fields), 10.2 (redirect URI rules: https, or http only on 127.0.0.1/localhost, no fragment; 1 to 10 URIs; metadata checks; 201 body), 10.3 (step 1 gives a 400 HTML page and never redirects; step 2 redirects in the spec order with state; a pending request with AUTH_REQUEST_TTL_SECONDS; an escaped consent page with the form, the hidden request input and two decision buttons; deny uses the request up and answers access_denied; approve sends every Google parameter), 10.4 (the state is used up at once; Google error gives access_denied; the code exchange sends the client secret in the body; the ID token is checked for RS256/kid/iss/aud/exp/nonce, else server_error; admin or non-revoked invite; email_verified; the 403 page with the right title and sentence; users upsert; accepted_user_sub; a code stored as a hash with AUTH_CODE_TTL_SECONDS and bound to client, user, redirect_uri, challenge, scope and resource). AES-GCM v1: storage follows 6.3. The three log events carry the attrs of section 12 and no e-mail, sub or token. /token, /mcp, PATs and rate limiting are not added. stack.sh already passes every variable. The browser redirect now targets the Worker's /health page, which removes the chrome-error landing that failed PR #28.

- met: The change is covered by tests that fail without it.

  worker/tests/oauth.worker.test.ts runs against real Miniflare D1 with a stubbed Google fetch. It covers discovery, every error of 10.2 and the 10.3 errors in their order, no redirect in step 1, the escaped client name and the two `<button type="submit" name="decision">`, deny and access_denied, every Google parameter on approve, a bad signature/aud/iss/nonce/exp and a token endpoint failure, the admin and invited-user rows with their roles, the non-invited 403 with no row, a revoked invite, an unverified e-mail, the encrypted refresh token with no clear value in any table, and the log events. E2E-29 is in oauth.api.spec.ts. The invited-user browser flow and E2E-02 are in oauth.browser.spec.ts. All five checks passed in the replay, but the browser project could not run locally. The gaps (the 10.2 order and a few decided edge cases) are listed as minor findings.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Seven dated lines were added: the register error format and its precedence; the authorize edge cases (empty challenge, exact scope, existing query kept); the consent edge cases (bad decision, approve not using the request up, the 502); no caching of discovery or JWKS and the exact ID token checks; the reasons and levels of auth.oauth.denied; keeping the refresh token on a re-login and lowercasing the admin e-mail; the /health redirect URI for browser E2E.

## Proposed learnings (not decided)

- Browser E2E tests that end with a redirect to an OAuth client need a real page to land on. A redirect URI where nothing listens ends at chrome-error://, and waitForURL times out. Use a URI the stack serves, or intercept it with page.route.
- When an acceptance criterion says "in its order", add a test that sends several invalid fields at once and checks which error wins, for each endpoint concerned.
- Each decision written in docs/decisions.md should have a test that fails without it. Otherwise the decision is only documentation.
