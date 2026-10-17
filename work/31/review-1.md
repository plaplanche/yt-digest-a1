# Review 1

- Reviewed commit: `8138d5737de2b354baadcc57e77e5b0e506a0777`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`worker/src/token.ts:120`) Reuse revocation can miss tokens issued by a concurrent rotation

  A rotation marks the refresh token used (UPDATE … RETURNING, line ~104) and then inserts the new pair in a separate batch (issue(), line ~40). If the same token is reused between those two statements, the family revocation (line 120) runs before the new pair is inserted. That pair then stays valid even though its family was revoked. The window is small, but this is exactly the stolen-token race that reuse detection exists for. Possible fixes: insert the new tokens only when the family has no revoked row (INSERT … SELECT … WHERE NOT EXISTS), or revoke by family again after the insert. The spec does not demand this explicitly (8.9 is about /node/*), so this is not blocking.

- **minor** (`worker/tests/token.worker.test.ts:131`) The 'another client' case does not prove the code was used up

  In the test.each about failed exchanges using up the code, the 'another client' case seeds the code for `other` and exchanges it twice with `clientId`. The second exchange would fail with invalid_grant (wrong client) even if the code had not been marked used, so this case does not show that 'a code is used up by a failed exchange'. The wrong-verifier and wrong-redirect cases do show it. For this case, the second exchange should use `client_id: other`, or the test should check `used_at` directly.

- **minor** (`docs/decisions.md:85`) The Content-Type decision is split over two lines

  Line 82 says the form is taken only when the Content-Type is application/x-www-form-urlencoded. Line 85 adds, as a separate entry, how that media type is compared. These should be one line, so docs/decisions.md doesn't contain an overly strict reading next to the actual rule.

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

  worker/src/token.ts implements POST /token as 10.5 requires: form-encoded only (400 invalid_request otherwise); checks run in the order grant type → client (401 invalid_client) → missing params → resource (invalid_target) → code; codes are consumed by an atomic UPDATE … RETURNING before the expiry, client, redirect_uri and S256 PKCE checks; responses are 200 with Cache-Control: no-store, the required body shape and 32-byte random tokens stored as SHA-256 hashes; refresh rotates within the family, accepts an optional resource, and on reuse gives invalid_grant, revokes the whole family and logs auth.refresh.reuse_detected (warn, client_id and revoked count). auth.token.issued is logged with client_id and grant_type. checkAccessToken implements 10.6: kind access, resource BASE/mcp, not expired or revoked, and admission read again on each call (ADMIN_EMAIL or an unrevoked invite). It adds no /mcp, admin scope or PAT. The log events were already in the contracts catalogue.

- met: The change is covered by tests that fail without it.

  worker/tests/token.worker.test.ts is new and covers every 10.5 error (unknown client, wrong verifier, used/expired/unknown code, another client, another redirect_uri, each missing parameter, wrong resource, unknown or missing grant, non-form bodies), the code being used up by a failed exchange, no-store, rotation that keeps earlier access tokens valid, and reuse revoking the family (access tokens included). It also covers the 10.6 cases (valid, expired, revoked, refresh token, node token, other resource, revoked invite, admin without invite), both log events with no secrets in them, and ACCESS_TOKEN_TTL_SECONDS. e2e/tests/token.api.spec.ts covers E2E-31 over HTTP through the consent form and the fake Google's login_hint, and shows the family's revocation at /token. /token and token.ts did not exist before, so these tests fail without the change. All checks are green.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Four dated lines were added: matching the Content-Type by media type, an empty parameter counting as missing, a missing grant_type or client_id, reuse by the same client even when the token is expired or already revoked, a foreign client getting a plain invalid_grant, refresh not re-reading admission, checkAccessToken's location, reason mapping and logging duty, and how admission is computed. The token TTL defaults come from spec 5.2. The split Content-Type entry is noted as minor.

## Proposed learnings (not decided)

- When reuse detection revokes a family, make sure the rotation's insert of the new pair can't land after the revocation: check the family's revoked state inside the insert, or revoke again afterwards.
- In tests that show a failed exchange used up a code, the follow-up exchange must be one that would succeed if the code were still unused. Otherwise the test proves nothing.
