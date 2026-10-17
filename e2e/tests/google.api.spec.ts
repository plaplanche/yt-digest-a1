import { createHash, createPublicKey, createVerify } from "node:crypto";
import { expect, test, type APIResponse } from "@playwright/test";

const mocks = `http://127.0.0.1:${process.env.MOCKS_PORT ?? "8789"}`;
const issuer = `${mocks}/google`;
const clientId = process.env.GOOGLE_CLIENT_ID ?? "yt-digest-local";
const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "local-google-secret";
const redirectUri = "http://worker.test/callback";

const authorizeUrl = (params: Record<string, string>): string =>
  `${issuer}/authorize?${new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: "openid email", ...params })}`;

async function login(request: import("@playwright/test").APIRequestContext, params: Record<string, string> = {}): Promise<{ code: string; state: string | null }> {
  const res = await request.get(authorizeUrl({ login_hint: "Bob@Test", state: "st-1", ...params }), { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  const location = new URL(res.headers()["location"]!);
  expect(`${location.origin}${location.pathname}`).toBe(redirectUri);
  return { code: location.searchParams.get("code")!, state: location.searchParams.get("state") };
}

const exchange = (request: import("@playwright/test").APIRequestContext, code: string, extra: Record<string, string> = {}): Promise<APIResponse> =>
  request.post(`${issuer}/token`, { form: { grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret, ...extra } });

const decode = (part: string): Record<string, unknown> => JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;

test("the discovery document", async ({ request }) => {
  const res = await request.get(`${issuer}/.well-known/openid-configuration`);
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    userinfo_endpoint: `${issuer}/userinfo`,
    jwks_uri: `${issuer}/jwks`,
    revocation_endpoint: `${issuer}/revoke`,
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
  });
});

test("authorize refuses a wrong client_id and a missing openid scope", async ({ request }) => {
  expect((await request.get(authorizeUrl({ client_id: "other" }))).status()).toBe(400);
  expect((await request.get(authorizeUrl({ scope: "email profile" }))).status()).toBe(400);
  expect((await request.get(authorizeUrl({ response_type: "token" }))).status()).toBe(400);
});

test("authorize without login_hint shows a form repeating every parameter", async ({ request }) => {
  const res = await request.get(authorizeUrl({ state: "abc", nonce: "n-1", access_type: "offline" }));
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/html");
  const html = await res.text();
  expect(html).toContain('<form method="get" action="/google/authorize">');
  for (const [name, value] of Object.entries({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: "openid email", state: "abc", nonce: "n-1", access_type: "offline" })) {
    expect(html).toContain(`<input type="hidden" name="${name}" value="${value}">`);
  }
  expect(html).toContain('name="login_hint"');
  expect(html).toContain('type="submit"');
});

test("the code gives an ID token signed with the JWKS key", async ({ request }) => {
  const before = Math.floor(Date.now() / 1000);
  const { code, state } = await login(request, { nonce: "n-42" });
  expect(state).toBe("st-1");
  const res = await exchange(request, code);
  expect(res.status()).toBe(200);
  const body = (await res.json()) as Record<string, unknown>;
  expect(body).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "openid email" });
  expect(body).not.toHaveProperty("refresh_token");

  const [header, payload, signature] = (body["id_token"] as string).split(".") as [string, string, string];
  const jwks = (await (await request.get(`${issuer}/jwks`)).json()) as { keys: (Record<string, unknown> & { kid: string })[] };
  expect(jwks.keys).toHaveLength(1);
  const key = jwks.keys[0]!;
  expect(key).toMatchObject({ kty: "RSA", alg: "RS256", use: "sig" });
  expect(decode(header)).toMatchObject({ alg: "RS256", kid: key.kid });
  const verifier = createVerify("RSA-SHA256").update(`${header}.${payload}`);
  expect(verifier.verify(createPublicKey({ key: key as never, format: "jwk" }), Buffer.from(signature, "base64url"))).toBe(true);

  const claims = decode(payload);
  const sub = `g-${createHash("sha256").update("bob@test").digest("hex").slice(0, 16)}`;
  expect(claims).toMatchObject({ iss: issuer, aud: clientId, sub, email: "bob@test", email_verified: true, nonce: "n-42" });
  expect(claims["iat"] as number).toBeGreaterThanOrEqual(before);
  expect(claims["exp"]).toBe((claims["iat"] as number) + 3600);
});

test("the code is single use and bound to its redirect_uri", async ({ request }) => {
  const { code } = await login(request);
  expect((await exchange(request, code)).status()).toBe(200);
  const again = await exchange(request, code);
  expect(again.status()).toBe(400);
  expect(await again.json()).toEqual({ error: "invalid_grant" });

  const other = await login(request);
  expect((await exchange(request, other.code, { redirect_uri: "http://worker.test/elsewhere" })).status()).toBe(400);
});

test("a wrong client secret gives 401 invalid_client; Basic authentication works", async ({ request }) => {
  const { code } = await login(request);
  const bad = await exchange(request, code, { client_secret: "nope" });
  expect(bad.status()).toBe(401);
  expect(await bad.json()).toEqual({ error: "invalid_client" });

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await request.post(`${issuer}/token`, { headers: { Authorization: `Basic ${basic}` }, form: { grant_type: "authorization_code", code, redirect_uri: redirectUri } });
  expect(res.status()).toBe(200);
});

test("access_type=offline gives a refresh token that yields new tokens", async ({ request }) => {
  const { code } = await login(request, { access_type: "offline" });
  const first = (await (await exchange(request, code)).json()) as { access_token: string; refresh_token: string };
  const res = await request.post(`${issuer}/token`, { form: { grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: clientId, client_secret: clientSecret } });
  expect(res.status()).toBe(200);
  const next = (await res.json()) as { access_token: string; id_token: string };
  expect(next.access_token).not.toBe(first.access_token);
  expect(decode(next.id_token.split(".")[1]!)).toMatchObject({ email: "bob@test" });

  const bad = await request.post(`${issuer}/token`, { form: { grant_type: "refresh_token", refresh_token: "unknown", client_id: clientId, client_secret: clientSecret } });
  expect(bad.status()).toBe(400);
  expect(await bad.json()).toEqual({ error: "invalid_grant" });
});

test("userinfo answers for its access token only", async ({ request }) => {
  const { code } = await login(request);
  const { access_token: token } = (await (await exchange(request, code)).json()) as { access_token: string };
  const ok = await request.get(`${issuer}/userinfo`, { headers: { Authorization: `Bearer ${token}` } });
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toEqual({ sub: `g-${createHash("sha256").update("bob@test").digest("hex").slice(0, 16)}`, email: "bob@test", email_verified: true });
  expect((await request.get(`${issuer}/userinfo`, { headers: { Authorization: "Bearer other" } })).status()).toBe(401);
  expect((await request.get(`${issuer}/userinfo`)).status()).toBe(401);
});

test("revoke answers 200", async ({ request }) => {
  expect((await request.post(`${issuer}/revoke`, { form: { token: "x" } })).status()).toBe(200);
});
