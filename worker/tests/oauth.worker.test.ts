import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import worker from "../src/index.js";

const BASE = "http://worker.test";
const REDIRECT = "http://127.0.0.1:9999/cb";
const GOOGLE = "http://google.test";

const call = (path: string, init?: RequestInit) => worker.fetch(new Request(`${BASE}${path}`, init), env);
const ops = (path: string, body: unknown) =>
  call(path, { method: "POST", headers: { Authorization: "Bearer ops-test" }, body: JSON.stringify(body) });
const post = (path: string, body: unknown) => call(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const form = (path: string, fields: Record<string, string>) =>
  call(path, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields) });

const b64url = (data: ArrayBuffer | string): string =>
  btoa(typeof data === "string" ? data : String.fromCharCode(...new Uint8Array(data))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

const keys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = { ...(await crypto.subtle.exportKey("jwk", keys.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
const otherKeys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);

async function idToken(claims: Record<string, unknown>, signWith = keys.privateKey): Promise<string> {
  const signingInput = `${b64url(JSON.stringify({ alg: "RS256", kid: "k1" }))}.${b64url(JSON.stringify(claims))}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signWith, new TextEncoder().encode(signingInput));
  return `${signingInput}.${b64url(sig)}`;
}

/** What the stubbed Google answers to the token endpoint. */
let google: { status: number; body: () => Promise<Record<string, unknown>> };
let tokenRequests: URLSearchParams[];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(async () => {
  expect((await ops("/ops/reset", {})).status).toBe(200);
  tokenRequests = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.href === `${GOOGLE}/.well-known/openid-configuration`) {
      return json({ issuer: GOOGLE, authorization_endpoint: `${GOOGLE}/authorize`, token_endpoint: `${GOOGLE}/token`, jwks_uri: `${GOOGLE}/jwks` });
    }
    if (url.href === `${GOOGLE}/jwks`) return json({ keys: [jwk] });
    if (url.href === `${GOOGLE}/token`) {
      tokenRequests.push(new URLSearchParams(String(init?.body)));
      return json(await google.body(), google.status);
    }
    throw new Error(`unexpected fetch ${url.href}`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const claimsFor = (email: string, extra: Record<string, unknown> = {}) => {
  const now = Math.floor(Date.now() / 1000);
  return { iss: GOOGLE, aud: "google-client", sub: `sub-${email}`, email, email_verified: true, iat: now, exp: now + 3600, ...extra };
};

/** Google answers with an ID token for `email`; the nonce is the one the Worker sent. */
function googleAnswers(email: string, opts: { claims?: Record<string, unknown>; signWith?: CryptoKey; refresh?: string | null } = {}) {
  google = {
    status: 200,
    body: async () => ({
      access_token: "google-access",
      id_token: await idToken(claimsFor(email, { nonce: currentNonce, ...opts.claims }), opts.signWith),
      ...(opts.refresh === null ? {} : { refresh_token: opts.refresh ?? "google-refresh-secret" }),
    }),
  };
}

let currentNonce = "";

async function registerClient(extra: Record<string, unknown> = {}): Promise<string> {
  const res = await post("/register", { redirect_uris: [REDIRECT], ...extra });
  return ((await res.json()) as { client_id: string }).client_id;
}

const authorizeQuery = (clientId: string, extra: Record<string, string | undefined> = {}) =>
  `/authorize?${new URLSearchParams(Object.entries({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: "chal", code_challenge_method: "S256", resource: `${BASE}/mcp`, state: "st", ...extra }).filter((e): e is [string, string] => e[1] !== undefined))}`;

/** Registers a client, opens the consent page and returns the pending request id. */
async function openConsent(): Promise<{ clientId: string; requestId: string }> {
  const clientId = await registerClient({ client_name: "My client" });
  const page = await (await call(authorizeQuery(clientId))).text();
  return { clientId, requestId: /name="request" value="([^"]+)"/.exec(page)![1]! };
}

/** Approves, and returns the callback query the fake Google would send back. */
async function approve(requestId: string): Promise<{ state: string; google: URL }> {
  const res = await form("/authorize/consent", { request: requestId, decision: "approve" });
  expect(res.status).toBe(302);
  const target = new URL(res.headers.get("Location")!);
  currentNonce = target.searchParams.get("nonce")!;
  return { state: target.searchParams.get("state")!, google: target };
}

const location = (res: Response) => new URL(res.headers.get("Location")!);

describe("discovery (10.1)", () => {
  test("protected resource metadata", async () => {
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
    const res = await post("/register", { redirect_uris: [REDIRECT, "https://app.example/cb"], client_name: "Name", grant_types: ["authorization_code"], response_types: ["code"], token_endpoint_auth_method: "none" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      client_name: "Name",
      redirect_uris: [REDIRECT, "https://app.example/cb"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
    expect((body["client_id"] as string).length).toBeGreaterThanOrEqual(16);
    expect(Math.abs((body["client_id_issued_at"] as number) - Date.now() / 1000)).toBeLessThan(5);
    const row = await env.DB.prepare("SELECT client_name, redirect_uris FROM oauth_clients WHERE client_id = ?").bind(body["client_id"]).first();
    expect(row).toEqual({ client_name: "Name", redirect_uris: JSON.stringify([REDIRECT, "https://app.example/cb"]) });
  });

  test("client_name is left out of the answer when not given", async () => {
    const body = (await (await post("/register", { redirect_uris: [REDIRECT] })).json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("client_name");
  });

  test.each([
    ["missing", undefined],
    ["empty", []],
    ["not an array", "https://a.example/cb"],
    ["eleven", Array.from({ length: 11 }, (_, i) => `https://a.example/${i}`)],
    ["http on a public host", ["http://a.example/cb"]],
    ["relative", ["/cb"]],
    ["a fragment", ["https://a.example/cb#x"]],
    ["another scheme", ["myapp://cb"]],
    ["a number", [1]],
  ])("redirect_uris %s is invalid_redirect_uri", async (_, uris) => {
    const res = await post("/register", { redirect_uris: uris });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_redirect_uri" });
  });

  test.each([
    ["localhost", "http://localhost:3000/cb"],
    ["127.0.0.1", "http://127.0.0.1/cb"],
  ])("http on %s is valid", async (_, uri) => {
    expect((await post("/register", { redirect_uris: [uri] })).status).toBe(201);
  });

  test.each([
    ["client_name too long", { client_name: "x".repeat(201) }],
    ["client_name not a string", { client_name: 1 }],
    ["auth method", { token_endpoint_auth_method: "client_secret_basic" }],
    ["grant type", { grant_types: ["implicit"] }],
    ["grant_types not an array", { grant_types: "authorization_code" }],
    ["response type", { response_types: ["token"] }],
  ])("%s is invalid_client_metadata", async (_, extra) => {
    const res = await post("/register", { redirect_uris: [REDIRECT], ...extra });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_client_metadata" });
  });

  test("a client_name of 200 characters is accepted", async () => {
    expect((await post("/register", { redirect_uris: [REDIRECT], client_name: "x".repeat(200) })).status).toBe(201);
  });

  test("a body that is not JSON is 400 invalid_request", async () => {
    const res = await call("/register", { method: "POST", body: "nope" });
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
  test("an unknown client or a missing or non-exact redirect_uri is a 400 HTML page, never a redirect", async () => {
    const clientId = await registerClient();
    const cases = [
      authorizeQuery("unknown"),
      authorizeQuery(clientId, { redirect_uri: undefined }),
      authorizeQuery(clientId, { redirect_uri: `${REDIRECT}/` }),
      authorizeQuery(clientId, { redirect_uri: `${REDIRECT}?x=1` }),
      authorizeQuery(clientId, { client_id: undefined }),
      // errors of step 2 do not matter when step 1 fails
      authorizeQuery(clientId, { redirect_uri: "http://127.0.0.1:1/other", response_type: "token" }),
    ];
    for (const path of cases) {
      const res = await call(path);
      expect(res.status, path).toBe(400);
      expect(res.headers.get("Content-Type")).toContain("text/html");
      expect(res.headers.get("Location")).toBeNull();
    }
  });

  test.each([
    ["response_type", { response_type: "token" }, "unsupported_response_type"],
    ["missing challenge", { code_challenge: undefined }, "invalid_request"],
    ["missing method", { code_challenge_method: undefined }, "invalid_request"],
    ["plain", { code_challenge_method: "plain" }, "invalid_request"],
    ["missing resource", { resource: undefined }, "invalid_target"],
    ["wrong resource", { resource: `${BASE}/other` }, "invalid_target"],
    ["resource with a slash", { resource: `${BASE}/mcp/` }, "invalid_target"],
    ["scope", { scope: "digest other" }, "invalid_scope"],
  ])("%s redirects with the error and the state", async (_, extra, error) => {
    const clientId = await registerClient();
    const res = await call(authorizeQuery(clientId, extra));
    expect(res.status).toBe(302);
    const target = location(res);
    expect(`${target.origin}${target.pathname}`).toBe(REDIRECT);
    expect(target.searchParams.get("error")).toBe(error);
    expect(target.searchParams.get("state")).toBe("st");
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM oauth_requests").first<{ n: number }>())?.n).toBe(0);
  });

  test("the errors are checked in order", async () => {
    const clientId = await registerClient();
    const all = { response_type: "token", code_challenge: undefined, resource: undefined, scope: "x" };
    expect(location(await call(authorizeQuery(clientId, all))).searchParams.get("error")).toBe("unsupported_response_type");
    expect(location(await call(authorizeQuery(clientId, { ...all, response_type: "code" }))).searchParams.get("error")).toBe("invalid_request");
    expect(location(await call(authorizeQuery(clientId, { ...all, response_type: "code", code_challenge: "c", code_challenge_method: "plain" }))).searchParams.get("error")).toBe("invalid_request");
    expect(location(await call(authorizeQuery(clientId, { ...all, response_type: "code", code_challenge: "c", code_challenge_method: "S256" }))).searchParams.get("error")).toBe("invalid_target");
    expect(location(await call(authorizeQuery(clientId, { ...all, response_type: "code", code_challenge: "c", code_challenge_method: "S256", resource: `${BASE}/mcp` }))).searchParams.get("error")).toBe("invalid_scope");
  });

  test("an error without a state redirects without one", async () => {
    const clientId = await registerClient();
    const target = location(await call(authorizeQuery(clientId, { response_type: "token", state: undefined })));
    expect(target.searchParams.has("state")).toBe(false);
  });

  test("the consent page shows the client name as escaped text and has approve and deny buttons", async () => {
    const clientId = await registerClient({ client_name: `<script>alert("x")</script> & co` });
    const res = await call(authorizeQuery(clientId));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const page = await res.text();
    expect(page).not.toContain("<script>");
    expect(page).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co");
    expect(page).toContain(REDIRECT);
    expect(page).toContain("digest");
    expect(page).toContain('<form method="post" action="/authorize/consent">');
    expect(page.match(/<button type="submit" name="decision"/g)).toHaveLength(2);
    expect(page).toContain('name="decision" value="approve"');
    expect(page).toContain('name="decision" value="deny"');
    const requestId = /<input type="hidden" name="request" value="([^"]+)"/.exec(page)![1]!;
    expect(requestId.length).toBeGreaterThanOrEqual(16);
    const row = await env.DB.prepare("SELECT client_id, redirect_uri, client_state, code_challenge, scope, resource FROM oauth_requests WHERE request_id = ?").bind(requestId).first();
    expect(row).toEqual({ client_id: clientId, redirect_uri: REDIRECT, client_state: "st", code_challenge: "chal", scope: "digest", resource: `${BASE}/mcp` });
  });

  test("a client without a name is shown by its client_id", async () => {
    const clientId = await registerClient();
    expect(await (await call(authorizeQuery(clientId))).text()).toContain(`<strong>${clientId}</strong>`);
  });

  test("the pending authorization expires after AUTH_REQUEST_TTL_SECONDS", async () => {
    const { requestId } = await openConsent();
    const row = await env.DB.prepare("SELECT expires_at FROM oauth_requests WHERE request_id = ?").bind(requestId).first<{ expires_at: string }>();
    expect(Math.abs(Date.parse(row!.expires_at) - Date.now() - 600_000)).toBeLessThan(5000);
  });
});

describe("POST /authorize/consent (10.3)", () => {
  test("an unknown, used or expired request is a 400 HTML page", async () => {
    const unknown = await form("/authorize/consent", { request: "nope", decision: "approve" });
    expect(unknown.status).toBe(400);
    expect(unknown.headers.get("Content-Type")).toContain("text/html");

    const { requestId } = await openConsent();
    expect((await form("/authorize/consent", { request: requestId, decision: "deny" })).status).toBe(302);
    expect((await form("/authorize/consent", { request: requestId, decision: "deny" })).status).toBe(400);
    expect((await form("/authorize/consent", { request: requestId, decision: "approve" })).status).toBe(400);

    const expired = await openConsent();
    await env.DB.prepare("UPDATE oauth_requests SET expires_at = ? WHERE request_id = ?").bind(new Date(Date.now() - 1000).toISOString(), expired.requestId).run();
    expect((await form("/authorize/consent", { request: expired.requestId, decision: "approve" })).status).toBe(400);
    expect((await form("/authorize/consent", { request: expired.requestId, decision: "deny" })).status).toBe(400);
  });

  test("deny redirects to the client with access_denied and its state", async () => {
    const { requestId } = await openConsent();
    const res = await form("/authorize/consent", { request: requestId, decision: "deny" });
    expect(res.status).toBe(302);
    const target = location(res);
    expect(`${target.origin}${target.pathname}`).toBe(REDIRECT);
    expect(target.searchParams.get("error")).toBe("access_denied");
    expect(target.searchParams.get("state")).toBe("st");
  });

  test("approve redirects to Google with every parameter", async () => {
    const { requestId } = await openConsent();
    const { google: target, state } = await approve(requestId);
    expect(`${target.origin}${target.pathname}`).toBe(`${GOOGLE}/authorize`);
    const q = target.searchParams;
    expect(q.get("client_id")).toBe("google-client");
    expect(q.get("redirect_uri")).toBe(`${BASE}/callback`);
    expect(q.get("response_type")).toBe("code");
    expect(q.get("scope")).toBe("openid email https://www.googleapis.com/auth/youtube.readonly");
    expect(q.get("access_type")).toBe("offline");
    expect(q.get("prompt")).toBe("consent");
    expect(state.length).toBeGreaterThanOrEqual(16);
    expect(q.get("nonce")!.length).toBeGreaterThanOrEqual(16);
    expect(state).not.toBe(q.get("nonce"));
    const row = await env.DB.prepare("SELECT google_state, google_nonce FROM oauth_requests WHERE request_id = ?").bind(requestId).first();
    expect(row).toEqual({ google_state: state, google_nonce: q.get("nonce") });
  });
});

describe("GET /callback (10.4)", () => {
  const run = async (email: string, opts?: Parameters<typeof googleAnswers>[1]) => {
    const { clientId, requestId } = await openConsent();
    const { state } = await approve(requestId);
    googleAnswers(email, opts);
    return { clientId, requestId, state, res: await call(`/callback?code=gcode&state=${state}`) };
  };

  test("an unknown, used or expired state is a 400 HTML page", async () => {
    expect((await call("/callback?code=c&state=nope")).status).toBe(400);
    expect((await call("/callback?code=c")).status).toBe(400);

    const { res, state } = await run("bob@test");
    expect(res.status).toBe(403); // not invited, but the state is used up either way
    const again = await call(`/callback?code=gcode&state=${state}`);
    expect(again.status).toBe(400);
    expect(again.headers.get("Content-Type")).toContain("text/html");

    const { requestId } = await openConsent();
    const approved = await approve(requestId);
    await env.DB.prepare("UPDATE oauth_requests SET expires_at = ? WHERE request_id = ?").bind(new Date(Date.now() - 1000).toISOString(), requestId).run();
    expect((await call(`/callback?code=c&state=${approved.state}`)).status).toBe(400);
  });

  test("an error from Google redirects to the client with access_denied and uses the state up", async () => {
    const { requestId } = await openConsent();
    const { state } = await approve(requestId);
    const res = await call(`/callback?error=access_denied&state=${state}`);
    expect(res.status).toBe(302);
    const target = location(res);
    expect(`${target.origin}${target.pathname}`).toBe(REDIRECT);
    expect(target.searchParams.get("error")).toBe("access_denied");
    expect(target.searchParams.get("state")).toBe("st");
    expect(tokenRequests).toHaveLength(0);
    expect((await call(`/callback?code=c&state=${state}`)).status).toBe(400);
  });

  test("the code is exchanged with the client secret in the body", async () => {
    await run("alice@test");
    expect(Object.fromEntries(tokenRequests[0]!)).toEqual({
      grant_type: "authorization_code",
      code: "gcode",
      redirect_uri: `${BASE}/callback`,
      client_id: "google-client",
      client_secret: "google-secret",
    });
  });

  test.each([
    ["a bad signature", { signWith: otherKeys.privateKey }],
    ["a wrong aud", { claims: { aud: "someone-else" } }],
    ["a wrong iss", { claims: { iss: "http://evil.test" } }],
    ["a wrong nonce", { claims: { nonce: "other" } }],
    ["a missing nonce", { claims: { nonce: undefined } }],
    ["an expired token", { claims: { exp: Math.floor(Date.now() / 1000) - 10 } }],
  ])("%s is refused with server_error and no row", async (_, opts) => {
    const { res, clientId } = await run("alice@test", opts);
    expect(res.status).toBe(302);
    const target = location(res);
    expect(`${target.origin}${target.pathname}`).toBe(REDIRECT);
    expect(target.searchParams.get("error")).toBe("server_error");
    expect(target.searchParams.get("state")).toBe("st");
    expect(target.searchParams.has("code")).toBe(false);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>())?.n).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM oauth_codes").first<{ n: number }>())?.n).toBe(0);
    expect(clientId).toBeTruthy();
  });

  test("a token endpoint failure or a missing id_token is server_error", async () => {
    const { requestId } = await openConsent();
    const { state } = await approve(requestId);
    google = { status: 400, body: async () => ({ error: "invalid_grant" }) };
    expect(location(await call(`/callback?code=c&state=${state}`)).searchParams.get("error")).toBe("server_error");

    const second = await approve((await openConsent()).requestId);
    google = { status: 200, body: async () => ({ access_token: "a" }) };
    expect(location(await call(`/callback?code=c&state=${second.state}`)).searchParams.get("error")).toBe("server_error");
  });

  test("the admin gets a code and an admin row without an invite", async () => {
    const { res, clientId } = await run("Alice@Test");
    expect(res.status).toBe(302);
    const target = location(res);
    expect(`${target.origin}${target.pathname}`).toBe(REDIRECT);
    expect(target.searchParams.get("state")).toBe("st");
    const code = target.searchParams.get("code")!;
    expect(code.length).toBeGreaterThanOrEqual(32);
    expect(await env.DB.prepare("SELECT user_sub, email, role FROM users").all().then((r) => r.results)).toEqual([{ user_sub: "sub-Alice@Test", email: "alice@test", role: "admin" }]);
    const row = await env.DB.prepare("SELECT * FROM oauth_codes").first<Record<string, unknown>>();
    expect(row).toMatchObject({ client_id: clientId, user_sub: "sub-Alice@Test", redirect_uri: REDIRECT, code_challenge: "chal", scope: "digest", resource: `${BASE}/mcp`, used_at: null });
    expect(row!["code_hash"]).toMatch(/^[0-9a-f]{64}$/);
    expect(row!["code_hash"]).not.toBe(code);
    expect(Math.abs(Date.parse(row!["expires_at"] as string) - Date.now() - 60_000)).toBeLessThan(5000);
  });

  test("an invited user gets a code, a member row and the invite is accepted", async () => {
    await ops("/ops/invites", { email: "bob@test" });
    const { res } = await run("bob@test");
    expect(location(res).searchParams.get("code")).toBeTruthy();
    expect(await env.DB.prepare("SELECT user_sub, email, role FROM users").all().then((r) => r.results)).toEqual([{ user_sub: "sub-bob@test", email: "bob@test", role: "member" }]);
    expect(await env.DB.prepare("SELECT accepted_user_sub FROM invites").first()).toEqual({ accepted_user_sub: "sub-bob@test" });
  });

  test("a second login updates the row and keeps the refresh token when Google sends none", async () => {
    await ops("/ops/invites", { email: "bob@test" });
    await run("bob@test", { refresh: "first-refresh" });
    const first = await env.DB.prepare("SELECT google_refresh_token_enc AS enc FROM users").first<{ enc: string }>();
    await run("bob@test", { refresh: null });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>())?.n).toBe(1);
    expect((await env.DB.prepare("SELECT google_refresh_token_enc AS enc FROM users").first<{ enc: string }>())?.enc).toBe(first!.enc);
  });

  test("a non-invited user gets the 403 page and no row", async () => {
    const { res } = await run("mallory@test");
    expect(res.status).toBe(403);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const page = await res.text();
    expect(page).toContain("<title>Access refused</title>");
    expect(page).toContain("This account is not invited.");
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>())?.n).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM oauth_codes").first<{ n: number }>())?.n).toBe(0);
  });

  test("a revoked invite is refused", async () => {
    await ops("/ops/invites", { email: "bob@test" });
    await ops("/ops/invites/revoke", { email: "bob@test" });
    expect((await run("bob@test")).res.status).toBe(403);
  });

  test("an unverified e-mail is refused, even the admin's", async () => {
    const { res } = await run("alice@test", { claims: { email_verified: false } });
    expect(res.status).toBe(403);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>())?.n).toBe(0);
  });

  test("the Google refresh token is stored encrypted and never in clear", async () => {
    await run("alice@test", { refresh: "google-refresh-secret" });
    const enc = (await env.DB.prepare("SELECT google_refresh_token_enc AS enc FROM users").first<{ enc: string }>())!.enc;
    expect(enc).toMatch(/^v1:[A-Za-z0-9+/]+=*$/);
    const raw = atob(enc.slice(3));
    expect(raw.length).toBe(12 + "google-refresh-secret".length + 16);
    // decrypts with the key
    const key = await crypto.subtle.importKey("raw", new Uint8Array(32), "AES-GCM", false, ["decrypt"]);
    const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12));
    expect(new TextDecoder().decode(plain)).toBe("google-refresh-secret");
    for (const table of ["users", "invites", "oauth_clients", "oauth_requests", "oauth_codes", "oauth_tokens"]) {
      const { results } = await env.DB.prepare(`SELECT * FROM ${table}`).all();
      expect(JSON.stringify(results)).not.toContain("google-refresh-secret");
    }
  });

  test("two encryptions of the same value differ (random IV)", async () => {
    await ops("/ops/invites", { email: "bob@test" });
    await run("bob@test", { refresh: "same" });
    const a = (await env.DB.prepare("SELECT google_refresh_token_enc AS enc FROM users").first<{ enc: string }>())!.enc;
    await env.DB.prepare("DELETE FROM users").run();
    await run("bob@test", { refresh: "same" });
    const b = (await env.DB.prepare("SELECT google_refresh_token_enc AS enc FROM users").first<{ enc: string }>())!.enc;
    expect(a).not.toBe(b);
  });

  test("logs auth.oauth.completed and auth.oauth.denied without e-mail, sub or code", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const ok = await run("alice@test");
    await run("mallory@test");
    const lines = spy.mock.calls.map((c) => String(c[0]));
    const events = lines.map((l) => JSON.parse(l) as { event: string; attrs: Record<string, unknown> });
    expect(events).toContainEqual(expect.objectContaining({ event: "auth.oauth.completed", attrs: { client_id: ok.clientId, role: "admin" } }));
    expect(events.find((e) => e.event === "auth.oauth.denied")?.attrs).toMatchObject({ reason: "not_invited" });
    const joined = lines.join("\n");
    for (const secret of ["alice@test", "mallory@test", "sub-alice", "google-refresh-secret", "gcode", location(ok.res).searchParams.get("code")!]) {
      expect(joined).not.toContain(secret);
    }
  });

  test("logs auth.oauth.denied on deny and on a Google error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const a = await openConsent();
    await form("/authorize/consent", { request: a.requestId, decision: "deny" });
    const b = await openConsent();
    const { state } = await approve(b.requestId);
    await call(`/callback?error=access_denied&state=${state}`);
    const c = await run("alice@test", { claims: { aud: "x" } });
    const denied = spy.mock.calls.map((x) => JSON.parse(String(x[0])) as { event: string; attrs: Record<string, unknown> }).filter((e) => e.event === "auth.oauth.denied");
    expect(denied.map((e) => e.attrs)).toEqual([
      { client_id: a.clientId, reason: "access_denied" },
      { client_id: b.clientId, reason: "access_denied" },
      { client_id: c.clientId, reason: "google_error" },
    ]);
  });
});
