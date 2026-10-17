# Review 2

- Reviewed commit: `63128769a410f4706eb1427a6de00b3be35fb6e8`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`worker/src/mcp.ts:43`) The Origin value is logged as-is, with no length limit

  Section 12 requires `auth.origin.rejected` to carry `origin`, so logging it is correct. But the value comes straight from an attacker-controlled header and is written unchanged and at any length. The header is free text, so it can hold anything, including an e-mail address, which section 12 forbids in a log line. Cutting the value to a reasonable length, or logging only a parsed `scheme://host[:port]`, would keep the log both safe and useful. This is not blocking because the spec asks for the origin.

- **minor** (`worker/src/mcp.ts:46`) The `Bearer` scheme is matched case-sensitively

  `/^Bearer (.+)$/` refuses `bearer xyz`, but the auth scheme is case-insensitive (RFC 7235 / RFC 6750). Common MCP clients send `Bearer`, so the practical impact is small. This is consistent with `/node/*` if that code does the same, but it is not written down in docs/decisions.md.

- **minor** (`worker/src/mcp.ts:63`) JSON-RPC responses and batches sent by the client get 400, not 202

  Streamable HTTP lets a client POST JSON-RPC responses, which the server acknowledges with 202. Here a message without `method` gets 400 `invalid_request`. Lot 2 never sends server-to-client requests, and the choice is recorded in decisions.md (batch / no string `method` → 400), so this is acceptable. Noted for later lots.

- **minor** (`docs/decisions.md:86`) Two decision lines each bundle several choices

  The project rule is one dated line per open choice. Lines 86 and 87 pack about ten separate choices each (stateless, JSON-only, check order, GET → 404, batch → 400, id rules, error codes, ALLOWED_ORIGINS parsing, log naming, timing). Every choice is written down, but splitting them would make them easier to review and amend.

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

  worker/src/mcp.ts: the Origin check comes first (403 `origin_rejected` with the 4.2 body, logs `auth.origin.rejected` with `origin`). Next comes `checkAccessToken` (10.6), giving 401 `invalid_token` plus `WWW-Authenticate: Bearer resource_metadata="BASE/.well-known/oauth-protected-resource"` and logging `auth.bearer.rejected` with surface `mcp`. Then the methods: `initialize` (protocolVersion 2025-06-18), notifications → 202 with no body, `ping`, `tools/list` (only `list_subscriptions`, inputSchema `{type:object,properties:{}}`), and `tools/call` (text `{"subscriptions":[]}`, isError false, logs `mcp.tool.call` with tool/outcome/duration_ms). ALLOWED_ORIGINS was already passed in by scripts/stack.sh:82 and is now typed in env.d.ts. The log events are already in contracts/log-event.schema.json. No other tools, no admin scope, no PATs, no sessions.

- met: The change is covered by tests that fail without it.

  worker/tests/mcp.worker.test.ts covers every acceptance criterion: no token, expired, node, operator and revoked-invite tokens → 401 with WWW-Authenticate; an access token on /node/heartbeat → 401; a foreign Origin → 403 before auth; BASE, absent and ALLOWED_ORIGINS origins pass; initialize, the 202 empty notification, tools/list, tools/call; plus the error paths and all three log events. Without mcp.ts, /mcp falls through to 404, so these tests fail (the /node 401 case passed already). e2e/tests/mcp.api.spec.ts covers E2E-27, E2E-33 and E2E-37, and mcp.browser.spec.ts covers E2E-28 in the `browser` project. All five checks are reported green.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  docs/decisions.md:86-87 record: stateless with no Mcp-Session-Id, JSON answers, check order origin → bearer → method, non-POST → 404, batch / missing method / invalid id → 400, any message without id is a notification, -32601 / -32602 error codes, jsonrpc must be "2.0", null id refused, client protocolVersion ignored, ALLOWED_ORIGINS parsing and exact matching, `unknown` as the tool name in the log for an unknown tool, and timing. The case-sensitive Bearer match is the only small gap (minor finding).

## Proposed learnings (not decided)

- When a spec requires logging a value taken from a request header (such as `origin`), cut or normalise it before logging. Otherwise the project's 'never in a log line' rules depend on attacker input.
- For an endpoint where the spec says 'before authentication', a good test is the one used here: send a foreign Origin with no token and assert 403, not 401.
- Write one decision per dated line in docs/decisions.md. Bundled lines make it hard to find and amend a single choice later.
