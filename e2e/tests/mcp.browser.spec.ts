import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";

const workerUrl = `http://127.0.0.1:${process.env.WORKER_PORT ?? "8787"}`;
const OPS = { Authorization: `Bearer ${process.env.OPS_TOKEN ?? "ops-local"}` };
// The client's redirect URI is a page the Worker serves, so the browser can land on it.
const REDIRECT = `${workerUrl}/health`;
const VERIFIER = "verifier-e2e-28";
const challenge = createHash("sha256").update(VERIFIER).digest("base64url");

test("E2E-28: registration, PKCE, resource, consent and fake Google login: the token lists and calls list_subscriptions", async ({ page, request }) => {
  expect((await request.post("/ops/reset", { headers: OPS })).status()).toBe(200);
  expect((await request.post("/ops/invites", { headers: OPS, data: { email: "bob@test" } })).status()).toBe(200);
  const registered = await request.post("/register", { data: { redirect_uris: [REDIRECT], client_name: "E2E client" } });
  const { client_id: clientId } = (await registered.json()) as { client_id: string };
  const params = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", resource: `${workerUrl}/mcp`, state: "st" });

  await page.goto(`/authorize?${params}`);
  await page.getByRole("button", { name: "Approve" }).click();
  await page.waitForURL(/\/google\/authorize/);
  await page.locator('input[name="login_hint"]').fill("bob@test");
  await page.locator('[type="submit"]').click();
  await page.waitForURL(/\/health\?code=/);
  const code = new URL(page.url()).searchParams.get("code")!;

  const exchanged = await request.post("/token", {
    form: { grant_type: "authorization_code", client_id: clientId, code, redirect_uri: REDIRECT, code_verifier: VERIFIER, resource: `${workerUrl}/mcp` },
  });
  expect(exchanged.status()).toBe(200);
  const headers = { Authorization: `Bearer ${((await exchanged.json()) as { access_token: string }).access_token}`, Accept: "application/json, text/event-stream" };

  const init = await request.post("/mcp", { headers, data: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } } } });
  expect(((await init.json()) as { result: { protocolVersion: string } }).result.protocolVersion).toBe("2025-06-18");
  expect((await request.post("/mcp", { headers, data: { jsonrpc: "2.0", method: "notifications/initialized" } })).status()).toBe(202);
  const list = (await (await request.post("/mcp", { headers, data: { jsonrpc: "2.0", id: 2, method: "tools/list" } })).json()) as { result: { tools: { name: string }[] } };
  expect(list.result.tools.map((t) => t.name)).toEqual(["list_subscriptions"]);
  const called = (await (await request.post("/mcp", { headers, data: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_subscriptions", arguments: {} } } })).json()) as {
    result: { isError: boolean; content: { text: string }[] };
  };
  expect(called.result.isError).toBe(false);
  expect(called.result.content[0]!.text).toBe('{"subscriptions":[]}');
});
