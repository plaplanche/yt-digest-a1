import { createHash } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";

const workerUrl = `http://127.0.0.1:${process.env.WORKER_PORT ?? "8787"}`;
const OPS = { Authorization: `Bearer ${process.env.OPS_TOKEN ?? "ops-local"}` };
const REDIRECT = "http://127.0.0.1:54321/callback";
const VERIFIER = "e2e-verifier";
const challenge = createHash("sha256").update(VERIFIER).digest("base64url");
const PING = { jsonrpc: "2.0", id: 1, method: "ping" };
const mcp = (request: APIRequestContext, token?: string) =>
  request.post("/mcp", { headers: { Accept: "application/json, text/event-stream", ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }) }, data: PING });

/** A full login over HTTP for an invited e-mail; returns the access token. */
async function accessToken(request: APIRequestContext, email: string): Promise<string> {
  expect((await request.post("/ops/invites", { headers: OPS, data: { email } })).status()).toBe(200);
  const registered = await request.post("/register", { data: { redirect_uris: [REDIRECT] } });
  const clientId = ((await registered.json()) as { client_id: string }).client_id;
  const params = { response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", resource: `${workerUrl}/mcp`, state: "st" };
  const page = await (await request.get("/authorize", { params })).text();
  const requestId = /name="request" value="([^"]+)"/.exec(page)![1]!;
  const consent = await request.post("/authorize/consent", { form: { request: requestId, decision: "approve" }, maxRedirects: 0 });
  const google = new URL(consent.headers()["location"]!);
  google.searchParams.set("login_hint", email);
  const signedIn = await request.get(google.toString(), { maxRedirects: 0 });
  const callback = await request.get(signedIn.headers()["location"]!, { maxRedirects: 0 });
  const code = new URL(callback.headers()["location"]!).searchParams.get("code")!;
  const exchanged = await request.post("/token", {
    form: { grant_type: "authorization_code", client_id: clientId, code, redirect_uri: REDIRECT, code_verifier: VERIFIER, resource: `${workerUrl}/mcp` },
  });
  expect(exchanged.status()).toBe(200);
  return ((await exchanged.json()) as { access_token: string }).access_token;
}

test.beforeEach(async ({ request }) => {
  expect((await request.post("/ops/reset", { headers: OPS })).status()).toBe(200);
});

test("E2E-27: /mcp without a token is 401 with WWW-Authenticate; the discovery documents agree", async ({ request }) => {
  const res = await mcp(request);
  expect(res.status()).toBe(401);
  expect(((await res.json()) as { error: string }).error).toBe("invalid_token");
  const header = res.headers()["www-authenticate"]!;
  const metadataUrl = /resource_metadata="([^"]+)"/.exec(header)![1]!;
  expect(metadataUrl).toBe(`${workerUrl}/.well-known/oauth-protected-resource`);

  const resource = (await (await request.get(metadataUrl)).json()) as { resource: string; authorization_servers: string[] };
  expect(resource.resource).toBe(`${workerUrl}/mcp`);
  const sub = (await (await request.get("/.well-known/oauth-protected-resource/mcp")).json()) as unknown;
  expect(sub).toEqual(resource);
  const server = (await (await request.get(`${resource.authorization_servers[0]}/.well-known/oauth-authorization-server`)).json()) as Record<string, string>;
  expect(server["issuer"]).toBe(resource.authorization_servers[0]);
  expect(server["token_endpoint"]).toBe(`${workerUrl}/token`);
});

test("E2E-33: a revoked invite refuses the user's valid access token", async ({ request }) => {
  const token = await accessToken(request, "bob@test");
  expect((await mcp(request, token)).status()).toBe(200);
  expect((await request.post("/ops/invites/revoke", { headers: OPS, data: { email: "bob@test" } })).status()).toBe(200);
  const res = await mcp(request, token);
  expect(res.status()).toBe(401);
  expect(res.headers()["www-authenticate"]).toContain("resource_metadata=");
});

test("E2E-37: a node token on /mcp, an access token on /node/*: refused", async ({ request }) => {
  const enrolled = await request.post("/ops/nodes", { headers: OPS, data: { node_id: "node-a", owner_label: "node-a" } });
  const nodeToken = ((await enrolled.json()) as { token: string }).token;
  expect((await mcp(request, nodeToken)).status()).toBe(401);

  const access = await accessToken(request, "bob@test");
  const res = await request.post("/node/heartbeat", { headers: { Authorization: `Bearer ${access}` }, data: {} });
  expect(res.status()).toBe(401);
});
