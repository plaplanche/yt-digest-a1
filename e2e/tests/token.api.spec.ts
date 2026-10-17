import { createHash } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";

const workerUrl = `http://127.0.0.1:${process.env.WORKER_PORT ?? "8787"}`;
const OPS = { Authorization: `Bearer ${process.env.OPS_TOKEN ?? "ops-local"}` };
const REDIRECT = "http://127.0.0.1:54321/callback";
const VERIFIER = "e2e-verifier";
const challenge = createHash("sha256").update(VERIFIER).digest("base64url");

interface Tokens {
  access_token: string;
  refresh_token: string;
}

/** The whole login over HTTP: consent form, fake Google with a login_hint, callback. Returns the client's code. */
async function loginCode(request: APIRequestContext, clientId: string, email: string): Promise<string> {
  const params = { response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", resource: `${workerUrl}/mcp`, state: "st" };
  const page = await (await request.get("/authorize", { params })).text();
  const requestId = /name="request" value="([^"]+)"/.exec(page)![1]!;
  const consent = await request.post("/authorize/consent", { form: { request: requestId, decision: "approve" }, maxRedirects: 0 });
  expect(consent.status()).toBe(302);
  const google = new URL(consent.headers()["location"]!);
  google.searchParams.set("login_hint", email);
  const signedIn = await request.get(google.toString(), { maxRedirects: 0 });
  expect(signedIn.status()).toBe(302);
  const callback = await request.get(signedIn.headers()["location"]!, { maxRedirects: 0 });
  expect(callback.status()).toBe(302);
  const code = new URL(callback.headers()["location"]!).searchParams.get("code");
  expect(code).toBeTruthy();
  return code!;
}

test.beforeEach(async ({ request }) => {
  expect((await request.post("/ops/reset", { headers: OPS })).status()).toBe(200);
});

test("E2E-31: refresh rotation; the reuse of an old refresh token revokes the family", async ({ request }) => {
  expect((await request.post("/ops/invites", { headers: OPS, data: { email: "bob@test" } })).status()).toBe(200);
  const registered = await request.post("/register", { data: { redirect_uris: [REDIRECT] } });
  const clientId = ((await registered.json()) as { client_id: string }).client_id;
  const form = (fields: Record<string, string>) => request.post("/token", { form: { client_id: clientId, ...fields } });

  const code = await loginCode(request, clientId, "bob@test");
  const exchanged = await form({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: VERIFIER, resource: `${workerUrl}/mcp` });
  expect(exchanged.status()).toBe(200);
  expect(exchanged.headers()["cache-control"]).toBe("no-store");
  const first = (await exchanged.json()) as Tokens;

  // the code is single-use
  const again = await form({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: VERIFIER, resource: `${workerUrl}/mcp` });
  expect(again.status()).toBe(400);
  expect(((await again.json()) as { error: string }).error).toBe("invalid_grant");

  const rotated = await form({ grant_type: "refresh_token", refresh_token: first.refresh_token });
  expect(rotated.status()).toBe(200);
  const second = (await rotated.json()) as Tokens;
  expect(second.refresh_token).not.toBe(first.refresh_token);
  expect(second.access_token).not.toBe(first.access_token);

  // the old refresh token is refused and the whole family goes with it
  const reuse = await form({ grant_type: "refresh_token", refresh_token: first.refresh_token });
  expect(reuse.status()).toBe(400);
  expect(((await reuse.json()) as { error: string }).error).toBe("invalid_grant");
  const afterRevocation = await form({ grant_type: "refresh_token", refresh_token: second.refresh_token });
  expect(afterRevocation.status()).toBe(400);
  expect(((await afterRevocation.json()) as { error: string }).error).toBe("invalid_grant");
});
