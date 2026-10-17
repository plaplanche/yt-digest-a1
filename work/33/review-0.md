# Review 0

- Reviewed commit: `b3d053c95eb6edbfa561f785bb29798f2285d985`
- Reviewer model: claude-opus-5-5
- Verdict: **no-go** (the reviewer answered no-go)

## Findings

- **blocking** (`worker/tests/mcp.worker.test.ts:1`) The log events of /mcp are not tested

  Spec 11.2 says `auth.origin.rejected` is logged, 11.3 says each call logs `mcp.tool.call` (attrs `tool`, `outcome`, `duration_ms`), and section 12 requires `auth.bearer.rejected` with `surface` `mcp` and its `reason`. These are in the ticket's decided spec and are rules of section 11, which spec 14 says must be covered by a test that fails without them. No test spies on `console.error` to check these events, unlike nodes.worker.test.ts:133-158 and token.worker.test.ts:238. If you delete the three `log(...)` calls in worker/src/mcp.ts, every test still passes. Add assertions on the event, its level and its attrs: origin rejected; bearer rejected with surface mcp and reasons missing/unknown/expired/revoked; tool call with outcome ok and error.

- **minor** (`worker/src/mcp.ts:33`) The logged tool name is unbounded client input

  `tool` is copied from `params.name` without any check, so an authenticated client can put any string into a worker log line, including an e-mail or a token, which spec 12 forbids in log lines. Log the name only when it is a known tool and use a fixed placeholder otherwise, or at least cap its length. The same applies to `origin` at line 41, but the spec explicitly asks for that attribute.

- **minor** (`worker/src/mcp.ts:30`) duration_ms measures nothing

  `started` is taken just before a synchronous name comparison, so `duration_ms` is always 0. That is harmless now, but the timer should wrap the actual tool execution, so later lots don't inherit a meaningless measurement.

- **minor** (`worker/src/mcp.ts:62`) `jsonrpc` is not checked and a null `id` is accepted

  A message without `jsonrpc: "2.0"` is processed. MCP forbids null request ids, but `id: null` gets a normal result here. Neither case is in docs/decisions.md, although the decision line lists the other validation rules.

- **minor** (`e2e/tests/mcp.api.spec.ts:38`) E2E-27 checks only one of the two protected-resource documents

  Spec 10.1 serves both `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp`. E2E-27 ('discovery documents served and consistent') fetches only the first. Comparing the `/mcp` variant as well would make the consistency check complete.

- **blocking** Definition of done not met: The change is covered by tests that fail without it.

  worker/tests/mcp.worker.test.ts covers every Worker acceptance case: no, expired, node, operator and revoked-invite tokens; an access token on /node/*; foreign, allowed and absent Origin; initialize, the notification, tools/list and tools/call. e2e/tests/mcp.api.spec.ts covers E2E-27, 33 and 37, and mcp.browser.spec.ts covers E2E-28. However, the log events auth.origin.rejected, mcp.tool.call and auth.bearer.rejected with surface mcp (spec 11.2, 11.3, 12) are not asserted anywhere; removing the log calls breaks no test. Also, the access-token-on-/node/* case passes without this change, since /node auth predates it.

- **blocking** Definition of done not met: Every choice the spec leaves open is written down in docs/decisions.md.

  docs/decisions.md:86 records several choices: stateless JSON transport, the order origin → bearer → method, 404 for non-POST, 400 for batch/missing method/bad id, no id meaning a notification, and -32601/-32602. Not recorded: the `jsonrpc` field is not checked, null ids are accepted, the client's protocolVersion in initialize is ignored, and how ALLOWED_ORIGINS is parsed (entries trimmed, empty ones dropped, origins matched exactly).

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

  worker/src/mcp.ts implements POST /mcp: JSON-RPC over Streamable HTTP (stateless, JSON responses), initialize with protocolVersion 2025-06-18, a 202 empty body for notifications, ping, tools/list returning exactly list_subscriptions with schema {type:object,properties:{}}, and tools/call returning {"subscriptions":[]} with isError false. The Origin check (PUBLIC_URL origin plus ALLOWED_ORIGINS) runs before checkAccessToken and answers 403 origin_rejected in the 4.2 body. The 401 is invalid_token in OAuth format with WWW-Authenticate resource_metadata. The three log events are emitted. ALLOWED_ORIGINS is already passed by scripts/stack.sh:82. No other tool, admin scope, PAT or session was added.

- **not met**: The change is covered by tests that fail without it.

  worker/tests/mcp.worker.test.ts covers every Worker acceptance case: no, expired, node, operator and revoked-invite tokens; an access token on /node/*; foreign, allowed and absent Origin; initialize, the notification, tools/list and tools/call. e2e/tests/mcp.api.spec.ts covers E2E-27, 33 and 37, and mcp.browser.spec.ts covers E2E-28. However, the log events auth.origin.rejected, mcp.tool.call and auth.bearer.rejected with surface mcp (spec 11.2, 11.3, 12) are not asserted anywhere; removing the log calls breaks no test. Also, the access-token-on-/node/* case passes without this change, since /node auth predates it.

- **not met**: Every choice the spec leaves open is written down in docs/decisions.md.

  docs/decisions.md:86 records several choices: stateless JSON transport, the order origin → bearer → method, 404 for non-POST, 400 for batch/missing method/bad id, no id meaning a notification, and -32601/-32602. Not recorded: the `jsonrpc` field is not checked, null ids are accepted, the client's protocolVersion in initialize is ignored, and how ALLOWED_ORIGINS is parsed (entries trimmed, empty ones dropped, origins matched exactly).

## Proposed learnings (not decided)

- When a spec section says an event 'is logged', require a console.error spy test for it; the repo already has this pattern (nodes.worker.test.ts) and reviewers should check that new surfaces use it.
- Attributes logged from client input (tool names, origins) can carry forbidden data such as e-mails or tokens; log only known values or bound them.
- A decisions.md line listing validation rules should cover every leniency the code adopts (unchecked jsonrpc, null id), not just the error codes.
