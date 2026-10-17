# Review 1

- Reviewed commit: `47cfdf2dac83f9173dabdfecfba59c43b7a6b794`
- Reviewer model: claude-opus-5-5
- Verdict: **no-go** (the reviewer answered no-go)

## Findings

- **blocking** (`worker/src/mcp.ts:64`) String JSON-RPC ids are refused, contrary to JSON-RPC 2.0, MCP and the recorded decision

  `if (typeof id !== "number") return errorResponse(400, ...)` rejects every request whose `id` is a string. JSON-RPC 2.0 and MCP 2025-06-18 both allow string ids, and docs/decisions.md line 87 says "an `id` that is a string or a number (a null `id` is refused)". An MCP client that uses string ids, which is allowed under 11.1 ('MCP Streamable HTTP, JSON-RPC 2.0'), could not initialize or call the tool. The `Id` type even includes `string`. The fix is `typeof id !== "string" && typeof id !== "number"` (and, if the decision means it, also refusing non-integer numbers), plus a test that sends a string id and gets 200 with that id echoed back.

- **minor** (`worker/tests/mcp.worker.test.ts:135`) Id validation tests miss the accepted-string case

  The validation suite only checks that a missing `jsonrpc` and a null `id` get 400. Nothing checks that a string id is accepted, which is how the blocking bug above got through with all checks green.

- **minor** (`worker/tests/mcp.worker.test.ts:175`) Test title contradicts what it asserts

  The title 'an unknown name is not logged' reads as if no event is logged for an unknown name, but the test expects two `mcp.tool.call` lines, the second with `tool: "unknown"`. What it means is that the raw name (here an e-mail address) is not logged. Renaming it would avoid confusion.

- **blocking** Definition of done not met: The change does what the ticket and spec/lot-2.md (and spec/lot-1.md, which still applies) say, and nothing more.

  The origin check, then the bearer check with the 401 and WWW-Authenticate, then initialize/ping/tools/list/tools/call, the 202 for notifications and the three log events match sections 11 and 12. The E2E-27/28/33/37 tests are in the right Playwright projects. But worker/src/mcp.ts:64 refuses string JSON-RPC ids, which breaks JSON-RPC 2.0 / MCP Streamable HTTP compliance (11.1) and the change's own decision.

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

- **not met**: The change does what the ticket and spec/lot-2.md (and spec/lot-1.md, which still applies) say, and nothing more.

  The origin check, then the bearer check with the 401 and WWW-Authenticate, then initialize/ping/tools/list/tools/call, the 202 for notifications and the three log events match sections 11 and 12. The E2E-27/28/33/37 tests are in the right Playwright projects. But worker/src/mcp.ts:64 refuses string JSON-RPC ids, which breaks JSON-RPC 2.0 / MCP Streamable HTTP compliance (11.1) and the change's own decision.

- met: The change is covered by tests that fail without it.

  worker/tests/mcp.worker.test.ts (new) covers every Worker acceptance criterion: no token, expired, node, operator and revoked-invite tokens, an access token on /node/*, the origin cases, initialize, the notification, tools/list, tools/call and the log events. The new e2e specs cover E2E-27, 33, 37 (api) and 28 (browser). /mcp did not exist before, so these tests fail without the change. The string-id case is not covered.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  docs/decisions.md lines 86-87 record: stateless with no session id, JSON answers, the order of checks, a non-POST is 404, batch and invalid-message handling, the JSON-RPC error codes, the client protocolVersion is ignored, how ALLOWED_ORIGINS is parsed, and the mcp.tool.call naming and timing. The code does not follow the recorded id rule, which is reported as a finding.

## Proposed learnings (not decided)

- When a decision line states an accepted input domain (e.g. 'string or number id'), test both the accepted and refused cases; only refusals were tested here and the accepted case was broken.
- For JSON-RPC endpoints, include a string-id request in protocol tests; many MCP clients use string ids.
