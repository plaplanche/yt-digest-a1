import { createHash } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";

const workerUrl = `http://127.0.0.1:${process.env.WORKER_PORT ?? "8787"}`;
const REDIRECT = "http://127.0.0.1:54321/callback";
const challenge = createHash("sha256").update("verifier").digest("base64url");

async function registerClient(request: APIRequestContext): Promise<string> {
  const res = await request.post("/register", { data: { redirect_uris: [REDIRECT], client_name: "E2E client" } });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { client_id: string }).client_id;
}

const authorize = (request: APIRequestContext, clientId: string, params: Record<string, string>) =>
  request.get("/authorize", {
    maxRedirects: 0,
    params: { response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", resource: `${workerUrl}/mcp`, state: "st-1", ...params },
  });

test.beforeEach(async ({ request }) => {
  const res = await request.post("/ops/reset", { headers: { Authorization: `Bearer ${process.env.OPS_TOKEN ?? "ops-local"}` } });
  expect(res.status()).toBe(200);
});

test("E2E-29: a request without PKCE, with plain PKCE or with another redirect_uri is refused", async ({ request }) => {
  const clientId = await registerClient(request);

  const noPkce = await authorize(request, clientId, { code_challenge: "", code_challenge_method: "" });
  expect(noPkce.status()).toBe(302);
  const refusal = new URL(noPkce.headers()["location"]!);
  expect(refusal.searchParams.get("error")).toBe("invalid_request");
  expect(refusal.searchParams.get("state")).toBe("st-1");

  const plain = await authorize(request, clientId, { code_challenge_method: "plain" });
  expect(plain.status()).toBe(302);
  expect(new URL(plain.headers()["location"]!).searchParams.get("error")).toBe("invalid_request");

  for (const redirectUri of [`${REDIRECT}/`, `${REDIRECT}?x=1`, "http://127.0.0.1:54321/other"]) {
    const other = await authorize(request, clientId, { redirect_uri: redirectUri });
    expect(other.status()).toBe(400);
    expect(other.headers()["location"]).toBeUndefined();
  }

  const ok = await authorize(request, clientId, {});
  expect(ok.status()).toBe(200);
  expect(await ok.text()).toContain('<form method="post" action="/authorize/consent">');
});
