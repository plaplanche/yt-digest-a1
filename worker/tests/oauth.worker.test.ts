import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import worker from "../src/index.js";

const BASE = "http://worker.test";
const ISSUER = "http://google.test";
const CLIENT_URI = "https://client.test/cb";

const call = (path: string, init?: RequestInit) => worker.fetch(new Request(`${BASE}${path}`, init), env);
const ops = (path: string, body?: unknown) =>
  worker.fetch(new Request(`${BASE}${path}`, { method: "POST", headers: { Authorization: "Bearer ops-test" }, body: JSON.stringify(body ?? {}) }), env);
const post = (path: string, body: unknown) => call(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const form = (path: string, fields: Record<string, string>) =>
  call(path, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields) });

const b64u = (data: ArrayBuffer | string): string => {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

const signing = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const otherKey = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = { ...(await crypto.subtle.exportKey("jwk", signing.publicKey)), kid: "k1", alg: "RS256", use: "sig" };

async function idToken(claims: Record<string, unknown>, key = signing.privateKey): Promise<string> {
  const input = `${b64u(JSON.stringify({ alg: "RS256", kid: "k1" }))}.${b64u(JSON.stringify(claims))}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input));
  return `${input}.${b64u(sig)}`;
}

/** What the stubbed Google answers on its token endpoint. */
let tokenAnswer: (nonce: string) => Promise<Record<string, unknown>>;
let tokenRequests: URLSearchParams[];
let nonceSeen = "";

const goodClaims = (email: string, extra: Record<string, unknown> = {}) => ({
  iss: ISSUER,
  aud: "yt-digest-test",
  sub: `sub-${email}`,
  email,
  email_verified: true,
  exp: Math.floor(Date.now() / 1000) + 3600,
  nonce: nonceSeen,
  ...extra,
});

beforeEach(async () => {
  await ops("/ops/reset");
  tokenRequests = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.href === `${ISSUER}/.well-known/openid-configuration`) {
      return Response.json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/jwks` });
    }
    if (url.href === `${ISSUER}/jwks`) return Response.json({ keys: [jwk] });
    if (url.href === `${ISSUER}/token`) {
      tokenRequests.push(new URLSearchParams(String(init?.body)));
      return Response.json(await tokenAnswer(nonceSeen));
    }
    return new Response("unexpected", { status: 500 });
  });
});
afterEach(() => vi.restoreAllMocks());

async function registerClient(name?: string): Promise<string> {
  const res = await post("/register", { redirect_uris: [CLIENT_URI], ...(name === undefined ? {} : { client_name: name }) });
  expect(res.status).toBe(201);
  return ((await res.json()) as { client_id: string }).client_id;
}

const authorizeQuery = (clientId: string, extra: Record<string, string | undefined> = {}): string => {
  const params: Record<string, string | undefined> = {
    response_type: "code",
    client_id: clientId,
    redirect_uri: CLIENT_URI,
    code_challenge: "challenge-value",
    code_challenge_method: "S256",
    resource: `${BASE}/mcp`,
    state: "client-state",
    ...extra,
  };
  return new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => e[1] !== undefined)).toString();
};

const location = (res: Response): URL => new URL(res.headers.get("Location")!);

async function pendingRequest(clientId: string): Promise<string> {
  const res = await call(`/authorize?${authorizeQuery(clientId)}`);
  expect(res.status).toBe(200);
  return /name="request" value="([^"]+)"/.exec(await res.text())![1]!;
}

/** Runs consent approval and returns the state and nonce sent to Google. */
async function approve(clientId: string): Promise<string> {
  const res = await form("/authorize/consent", { request: await pendingRequest(clientId), decision: "approve" });
  expect(res.status).toBe(302);
  nonceSeen = location(res).searchParams.get("nonce")!;
  return location(res).searchParams.get("state")!;
}

async function logins(email: string, tokenExtra: Record<string, unknown> = {}, claims: Record<string, unknown> = {}) {
  const clientId = await registerClient();
  const state = await approve(clientId);
  tokenAnswer = async () => ({ access_token: "g-access", refresh_token: "g-refresh-secret", id_token: await idToken(goodClaims(email, claims)), ...tokenExtra });
  const res = await call(`/callback?code=gcode&state=${state}`);
  return { res, clientId, state };
}

describe("discovery (10.1)", () => {
  test("protected resource metadata, on both paths", async () => {
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
      const res = await call(path);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ resource: `${BASE}/mcp`, authorization_servers: [BASE], scopes_supported: ["digest"], bearer_methods_supported: ["header"] });
    }
  });

  test("authorization server metadata", async () => {
    const res = await call("/.well-known/oauth-authorization-server");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      issuer: BASE,
      authorization_endpoint: `${BASE}/authorize`,
      token_endpoint: `${BASE}/token`,
      registration_endpoint: `${BASE}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["digest"],
    });
  });
});

describe("POST /register (10.2)", () => {
  test("registers a public client", async () => {
    const res = await post("/register", { redirect_uris: [CLIENT_URI, "http://127.0.0.1:9/cb", "http://localhost/cb"], client_name: "My <b>client</b>" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(String(body["client_id"]).length).toBeGreaterThanOrEqual(16);
    expect(body).toMatchObject({
      client_name: "My <b>client</b>",
      redirect_uris: [CLIENT_URI, "http://127.0.0.1:9/cb", "http://localhost/cb"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
    expect(typeof body["client_id_issued_at"]).toBe("number");
    expect(await env.DB.prepare("SELECT client_name FROM oauth_clients WHERE client_id = ?").bind(body["client_id"]).first()).toEqual({ client_name: "My <b>client</b>" });
  });

  test("no client_name in the answer when none was given", async () => {
    const body = (await (await post("/register", { redirect_uris: [CLIENT_URI] })).json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("client_name");
  });

  test.each([
    ["missing", {}],
    ["empty", { redirect_uris: [] }],
    ["not an array", { redirect_uris: CLIENT_URI }],
    ["more than 10", { redirect_uris: Array.from({ length: 11 }, (_, i) => `https://c.test/${i}`) }],
    ["relative", { redirect_uris: ["/cb"] }],
    ["plain http on another host", { redirect_uris: ["http://client.test/cb"] }],
    ["with a fragment", { redirect_uris: ["https://client.test/cb#x"] }],
    ["a custom scheme", { redirect_uris: ["app://cb"] }],
    ["one valid, one not", { redirect_uris: [CLIENT_URI, "ftp://x/cb"] }],
  ])("redirect_uris %s: invalid_redirect_uri", async (_name, body) => {
    const res = await post("/register", body);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_redirect_uri" });
  });

  test.each([
    ["client_name too long", { client_name: "x".repeat(201) }],
    ["client_name not a string", { client_name: 3 }],
    ["token_endpoint_auth_method", { token_endpoint_auth_method: "client_secret_basic" }],
    ["grant_types", { grant_types: ["password"] }],
    ["response_types", { response_types: ["token"] }],
  ])("%s: invalid_client_metadata", async (_name, extra) => {
    const res = await post("/register", { redirect_uris: [CLIENT_URI], ...extra });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_client_metadata" });
  });

  test("accepts the documented optional values", async () => {
    const res = await post("/register", { redirect_uris: [CLIENT_URI], token_endpoint_auth_method: "none", grant_types: ["authorization_code"], response_types: ["code"] });
    expect(res.status).toBe(201);
  });

  test("an unparsable body is invalid_request", async () => {
    const res = await call("/register", { method: "POST", body: "{nope" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_request" });
  });

  test("logs auth.client.registered", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const clientId = await registerClient();
    const events = spy.mock.calls.map((c) => JSON.parse(String(c[0])) as { event: string; attrs: unknown });
    expect(events).toContainEqual(expect.objectContaining({ event: "auth.client.registered", attrs: { client_id: clientId } }));
  });
});

describe("GET /authorize (10.3)", () => {
  test("an unknown client or a bad redirect_uri is a 400 HTML page, never a redirect", async () => {
    const clientId = await registerClient();
    for (const query of [
      authorizeQuery("unknown-client"),
      authorizeQuery(clientId, { redirect_uri: undefined }),
      authorizeQuery(clientId, { redirect_uri: `${CLIENT_URI}/` }),
      authorizeQuery(clientId, { redirect_uri: "https://evil.test/cb" }),
      authorizeQuery(clientId, { client_id: undefined }),
      authorizeQuery(clientId, { redirect_uri: "https://evil.test/cb", response_type: "token" }),
    ]) {
      const res = await call(`/authorize?${query}`);
      expect(res.status).toBe(400);
      expect(res.headers.get("Content-Type")).toContain("text/html");
      expect(res.headers.get("Location")).toBeNull();
    }
  });

  test.each([
    ["response_type", { response_type: "token" }, "unsupported_response_type"],
    ["response_type before PKCE", { response_type: "token", code_challenge: undefined }, "unsupported_response_type"],
    ["missing code_challenge", { code_challenge: undefined }, "invalid_request"],
    ["missing method", { code_challenge_method: undefined }, "invalid_request"],
    ["plain method", { code_challenge_method: "plain" }, "invalid_request"],
    ["PKCE before resource", { code_challenge: undefined, resource: undefined }, "invalid_request"],
    ["missing resource", { resource: undefined }, "invalid_target"],
    ["wrong resource", { resource: `${BASE}/mcp/` }, "invalid_target"],
    ["resource before scope", { resource: "x", scope: "other" }, "invalid_target"],
    ["scope", { scope: "other" }, "invalid_scope"],
    ["scope with more", { scope: "digest other" }, "invalid_scope"],
  ])("%s redirects with %s", async (_name, extra, error) => {
    const clientId = await registerClient();
    const res = await call(`/authorize?${authorizeQuery(clientId, extra)}`);
    expect(res.status).toBe(302);
    const to = location(res);
    expect(`${to.origin}${to.pathname}`).toBe(CLIENT_URI);
    expect(to.searchParams.get("error")).toBe(error);
    expect(to.searchParams.get("state")).toBe("client-state");
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM oauth_requests").first<{ n: number }>())!.n).toBe(0);
  });

  test("the error redirect has no state when the client sent none", async () => {
    const clientId = await registerClient();
    const res = await call(`/authorize?${authorizeQuery(clientId, { response_type: "token", state: undefined })}`);
    expect(location(res).searchParams.has("state")).toBe(false);
  });

  test("the consent page escapes the client name and has the two decision buttons", async () => {
    const clientId = await registerClient('<script>alert("x")</script>');
    const res = await call(`/authorize?${authorizeQuery(clientId, { scope: "digest" })}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const page = await res.text();
    expect(page).not.toContain("<script>");
    expect(page).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(page).toContain(CLIENT_URI);
    expect(page).toContain("digest");
    expect(page).toContain('<form method="post" action="/authorize/consent">');
    expect(page).toContain('<button type="submit" name="decision" value="approve">');
    expect(page).toContain('<button type="submit" name="decision" value="deny">');
    const id = /name="request" value="([^"]+)"/.exec(page)![1]!;
    expect(id.length).toBeGreaterThanOrEqual(16);
    expect(await env.DB.prepare("SELECT client_id, redirect_uri, client_state, code_challenge, scope, resource FROM oauth_requests WHERE request_id = ?").bind(id).first()).toEqual({
      client_id: clientId,
      redirect_uri: CLIENT_URI,
      client_state: "client-state",
      code_challenge: "challenge-value",
      scope: "digest",
      resource: `${BASE}/mcp`,
    });
  });

  test("a client without a name shows its client_id", async () => {
    const clientId = await registerClient();
    expect(await (await call(`/authorize?${authorizeQuery(clientId)}`)).text()).toContain(clientId);
  });
});

describe("POST /authorize/consent (10.3)", () => {
  test("unknown, expired and used requests are a 400 HTML page", async () => {
    const clientId = await registerClient();
    const id = await pendingRequest(clientId);
    const unknown = await form("/authorize/consent", { request: "nope", decision: "approve" });
    expect(unknown.status).toBe(400);
    expect(unknown.headers.get("Content-Type")).toContain("text/html");
    expect((await form("/authorize/consent", { decision: "approve" })).status).toBe(400);

    await env.DB.prepare("UPDATE oauth_requests SET expires_at = ? WHERE request_id = ?").bind(new Date(Date.now() - 1000).toISOString(), id).run();
    expect((await form("/authorize/consent", { request: id, decision: "approve" })).status).toBe(400);

    const id2 = await pendingRequest(clientId);
    expect((await form("/authorize/consent", { request: id2, decision: "deny" })).status).toBe(302);
    expect((await form("/authorize/consent", { request: id2, decision: "approve" })).status).toBe(400);
  });

  test("deny redirects with access_denied and the state, and logs it", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const clientId = await registerClient();
    const res = await form("/authorize/consent", { request: await pendingRequest(clientId), decision: "deny" });
    expect(res.status).toBe(302);
    const to = location(res);
    expect(`${to.origin}${to.pathname}`).toBe(CLIENT_URI);
    expect(to.searchParams.get("error")).toBe("access_denied");
    expect(to.searchParams.get("state")).toBe("client-state");
    const events = spy.mock.calls.map((c) => JSON.parse(String(c[0])) as { event: string; attrs: unknown });
    expect(events).toContainEqual(expect.objectContaining({ event: "auth.oauth.denied", attrs: { client_id: clientId, reason: "access_denied" } }));
  });

  test("approve redirects to Google with every parameter", async () => {
    const clientId = await registerClient();
    const id = await pendingRequest(clientId);
    const res = await form("/authorize/consent", { request: id, decision: "approve" });
    expect(res.status).toBe(302);
    const to = location(res);
    expect(`${to.origin}${to.pathname}`).toBe(`${ISSUER}/authorize`);
    const q = to.searchParams;
    expect(Object.fromEntries(q)).toEqual({
      client_id: "yt-digest-test",
      redirect_uri: `${BASE}/callback`,
      response_type: "code",
      scope: "openid email https://www.googleapis.com/auth/youtube.readonly",
      state: q.get("state"),
      nonce: q.get("nonce"),
      access_type: "offline",
      prompt: "consent",
    });
    expect(q.get("state")!.length).toBeGreaterThanOrEqual(16);
    expect(q.get("nonce")!.length).toBeGreaterThanOrEqual(16);
    expect(await env.DB.prepare("SELECT google_state, google_nonce FROM oauth_requests WHERE request_id = ?").bind(id).first()).toEqual({ google_state: q.get("state"), google_nonce: q.get("nonce") });
  });

  test("any other decision is refused", async () => {
    const clientId = await registerClient();
    expect((await form("/authorize/consent", { request: await pendingRequest(clientId), decision: "maybe" })).status).toBe(400);
  });
});

describe("GET /callback (10.4)", () => {
  test("a bad, missing or used state is a 400 HTML page", async () => {
    expect((await call("/callback?code=c&state=bad")).status).toBe(400);
    expect((await call("/callback?code=c")).status).toBe(400);
    const { state } = await logins("bob@test");
    const again = await call(`/callback?code=c&state=${state}`);
    expect(again.status).toBe(400);
    expect(again.headers.get("Content-Type")).toContain("text/html");
  });

  test("an expired pending authorization is refused", async () => {
    const clientId = await registerClient();
    const state = await approve(clientId);
    await env.DB.prepare("UPDATE oauth_requests SET expires_at = ?").bind(new Date(Date.now() - 1000).toISOString()).run();
    expect((await call(`/callback?code=c&state=${state}`)).status).toBe(400);
  });

  test("an error from Google redirects with access_denied, and uses the request up", async () => {
    const clientId = await registerClient();
    const state = await approve(clientId);
    const res = await call(`/callback?error=access_denied&state=${state}`);
    expect(res.status).toBe(302);
    expect(location(res).searchParams.get("error")).toBe("access_denied");
    expect(location(res).searchParams.get("state")).toBe("client-state");
    expect((await call(`/callback?code=c&state=${state}`)).status).toBe(400);
  });

  test("an invited user gets a code and a member row; the exchange sends the secret in the body", async () => {
    await ops("/ops/invites", { email: "Bob@Test" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { res, clientId } = await logins("bob@test");
    expect(res.status).toBe(302);
    const to = location(res);
    expect(`${to.origin}${to.pathname}`).toBe(CLIENT_URI);
    expect(to.searchParams.get("state")).toBe("client-state");
    const code = to.searchParams.get("code")!;
    expect(Object.fromEntries(tokenRequests[0]!)).toEqual({
      grant_type: "authorization_code",
      code: "gcode",
      redirect_uri: `${BASE}/callback`,
      client_id: "yt-digest-test",
      client_secret: "google-secret-test",
    });
    const user = await env.DB.prepare("SELECT user_sub, email, role FROM users").first();
    expect(user).toEqual({ user_sub: "sub-bob@test", email: "bob@test", role: "member" });
    expect(await env.DB.prepare("SELECT accepted_user_sub FROM invites").first()).toEqual({ accepted_user_sub: "sub-bob@test" });
    const row = await env.DB.prepare("SELECT code_hash, client_id, user_sub, redirect_uri, code_challenge, scope, resource, used_at FROM oauth_codes").first<Record<string, unknown>>();
    expect(row).toMatchObject({ client_id: clientId, user_sub: "sub-bob@test", redirect_uri: CLIENT_URI, code_challenge: "challenge-value", scope: "digest", resource: `${BASE}/mcp`, used_at: null });
    expect(row!["code_hash"]).not.toBe(code);
    expect(row!["code_hash"]).toMatch(/^[0-9a-f]{64}$/);
    const lines = spy.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes('"auth.oauth.completed"') && l.includes('"role":"member"'))).toBe(true);
    expect(lines.join("\n")).not.toMatch(/bob@test|sub-bob|g-refresh-secret/);
    expect(lines.join("\n")).not.toContain(code);
  });

  test("the admin needs no invite", async () => {
    const { res } = await logins("Alice@Test");
    expect(res.status).toBe(302);
    expect(location(res).searchParams.get("code")).toBeTruthy();
    expect(await env.DB.prepare("SELECT email, role FROM users").first()).toEqual({ email: "alice@test", role: "admin" });
  });

  test("a non-invited user gets the 403 page and no users row", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { res, clientId } = await logins("mallory@test");
    expect(res.status).toBe(403);
    const page = await res.text();
    expect(page).toContain("<title>Access refused</title>");
    expect(page).toContain("This account is not invited.");
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>())!.n).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM oauth_codes").first<{ n: number }>())!.n).toBe(0);
    const events = spy.mock.calls.map((c) => JSON.parse(String(c[0])) as { event: string; attrs: unknown });
    expect(events).toContainEqual(expect.objectContaining({ event: "auth.oauth.denied", attrs: { client_id: clientId, reason: "not_invited" } }));
  });

  test("a revoked invite is refused", async () => {
    await ops("/ops/invites", { email: "bob@test" });
    await ops("/ops/invites/revoke", { email: "bob@test" });
    expect((await logins("bob@test")).res.status).toBe(403);
  });

  test("an unverified e-mail is refused, even for the admin", async () => {
    const { res } = await logins("alice@test", {}, { email_verified: false });
    expect(res.status).toBe(403);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>())!.n).toBe(0);
  });

  test.each([
    ["a bad signature", async (nonce: string) => idToken(goodClaims("alice@test", { nonce }), otherKey.privateKey)],
    ["a wrong aud", async (nonce: string) => idToken(goodClaims("alice@test", { nonce, aud: "someone-else" }))],
    ["a wrong iss", async (nonce: string) => idToken(goodClaims("alice@test", { nonce, iss: "http://evil.test" }))],
    ["a wrong nonce", async () => idToken(goodClaims("alice@test", { nonce: "other-nonce" }))],
    ["a missing nonce", async () => idToken(goodClaims("alice@test", { nonce: undefined }))],
    ["an expired token", async (nonce: string) => idToken(goodClaims("alice@test", { nonce, exp: Math.floor(Date.now() / 1000) - 10 }))],
    ["a garbage token", async () => "not.a.jwt"],
  ])("%s redirects with server_error", async (_name, make) => {
    const clientId = await registerClient();
    const state = await approve(clientId);
    tokenAnswer = async (nonce) => ({ access_token: "a", id_token: await make(nonce) });
    const res = await call(`/callback?code=gcode&state=${state}`);
    expect(res.status).toBe(302);
    expect(location(res).searchParams.get("error")).toBe("server_error");
    expect(location(res).searchParams.get("state")).toBe("client-state");
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>())!.n).toBe(0);
  });

  test("a failing token exchange redirects with server_error", async () => {
    const clientId = await registerClient();
    const state = await approve(clientId);
    tokenAnswer = async () => ({ error: "invalid_grant" });
    const res = await call(`/callback?code=gcode&state=${state}`);
    expect(location(res).searchParams.get("error")).toBe("server_error");
  });

  test("the Google refresh token is stored encrypted, and kept when a later login brings none", async () => {
    const first = await logins("alice@test");
    expect(first.res.status).toBe(302);
    const stored = (await env.DB.prepare("SELECT google_refresh_token_enc AS v FROM users").first<{ v: string }>())!.v;
    expect(stored).toMatch(/^v1:[A-Za-z0-9+/]+=*$/);
    expect(stored).not.toContain("g-refresh-secret");
    const dump = JSON.stringify(
      await Promise.all(["users", "invites", "oauth_clients", "oauth_requests", "oauth_codes", "oauth_tokens"].map((t) => env.DB.prepare(`SELECT * FROM ${t}`).all().then((r) => r.results))),
    );
    expect(dump).not.toContain("g-refresh-secret");

    const clientId = await registerClient();
    const state = await approve(clientId);
    tokenAnswer = async () => ({ access_token: "a", id_token: await idToken(goodClaims("alice@test")) });
    expect((await call(`/callback?code=gcode&state=${state}`)).status).toBe(302);
    expect((await env.DB.prepare("SELECT google_refresh_token_enc AS v FROM users").first<{ v: string }>())!.v).toBe(stored);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>())!.n).toBe(1);
  });

  test("the encrypted value decrypts with the key and a random IV", async () => {
    const { decryptSecret, encryptSecret } = await import("../src/crypto.js");
    const a = await encryptSecret("secret", env.TOKEN_ENC_KEY);
    const b = await encryptSecret("secret", env.TOKEN_ENC_KEY);
    expect(a).not.toBe(b);
    expect(await decryptSecret(a, env.TOKEN_ENC_KEY)).toBe("secret");
  });
});
