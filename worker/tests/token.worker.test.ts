import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, test, vi } from "vitest";
import worker from "../src/index.js";
import { sha256Hex } from "../src/crypto.js";
import { checkAccessToken } from "../src/token.js";

const BASE = "http://worker.test";
const REDIRECT = "http://127.0.0.1:9999/cb";
const VERIFIER = "a-verifier";
const RESOURCE = `${BASE}/mcp`;

const call = (path: string, init?: RequestInit) => worker.fetch(new Request(`${BASE}${path}`, init), env);
const ops = (path: string, body: unknown) => call(path, { method: "POST", headers: { Authorization: "Bearer ops-test" }, body: JSON.stringify(body) });
const token = (fields: Record<string, string>) =>
  call("/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields) });

const challengeOf = async (verifier: string): Promise<string> =>
  btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

let clientId: string;

beforeEach(async () => {
  expect((await ops("/ops/reset", {})).status).toBe(200);
  await ops("/ops/invites", { email: "bob@test" });
  await env.DB.prepare("INSERT INTO users (user_sub, email, role, created_at) VALUES ('sub-bob', 'bob@test', 'member', ?)").bind(new Date().toISOString()).run();
  clientId = await registerClient();
});

async function registerClient(): Promise<string> {
  const res = await call("/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ redirect_uris: [REDIRECT] }) });
  return ((await res.json()) as { client_id: string }).client_id;
}

/** Stores an authorization code as the callback would. */
async function seedCode(over: { client?: string; expiresInMs?: number; userSub?: string } = {}): Promise<string> {
  const code = `code-${crypto.randomUUID()}`;
  await env.DB.prepare("INSERT INTO oauth_codes (code_hash, client_id, user_sub, redirect_uri, code_challenge, scope, resource, expires_at) VALUES (?, ?, ?, ?, ?, 'digest', ?, ?)")
    .bind(await sha256Hex(code), over.client ?? clientId, over.userSub ?? "sub-bob", REDIRECT, await challengeOf(VERIFIER), RESOURCE, new Date(Date.now() + (over.expiresInMs ?? 60000)).toISOString())
    .run();
  return code;
}

const exchange = async (code: string, over: Record<string, string> = {}) =>
  token({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: VERIFIER, resource: RESOURCE, ...over });

const refresh = (refreshToken: string, over: Record<string, string> = {}) => token({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, ...over });

async function login(): Promise<Tokens> {
  const res = await exchange(await seedCode());
  expect(res.status).toBe(200);
  return (await res.json()) as Tokens;
}

async function expectError(res: Response, status: number, error: string): Promise<void> {
  expect(res.status).toBe(status);
  expect(res.headers.get("Content-Type")).toBe("application/json");
  expect(((await res.json()) as { error: string }).error).toBe(error);
}

describe("POST /token, authorization_code (10.5)", () => {
  test("issues a pair of tokens bound to the resource", async () => {
    const res = await exchange(await seedCode());
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as Tokens;
    expect(body).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "digest" });
    expect(body.access_token.length).toBeGreaterThanOrEqual(32);
    expect(body.refresh_token.length).toBeGreaterThanOrEqual(32);
    expect(body.access_token).not.toBe(body.refresh_token);
    const rows = await env.DB.prepare("SELECT kind, resource, user_sub, token_hash FROM oauth_tokens ORDER BY kind").all<{ kind: string; resource: string; user_sub: string; token_hash: string }>();
    expect(rows.results.map((r) => [r.kind, r.resource, r.user_sub])).toEqual([["access", RESOURCE, "sub-bob"], ["refresh", RESOURCE, "sub-bob"]]);
    expect(rows.results[0]!.token_hash).toBe(await sha256Hex(body.access_token));
  });

  test("unknown client: 401 invalid_client", async () => {
    await expectError(await exchange(await seedCode(), { client_id: "nope" }), 401, "invalid_client");
  });

  test("unsupported grant type, missing grant type", async () => {
    await expectError(await token({ grant_type: "password", client_id: clientId }), 400, "unsupported_grant_type");
    await expectError(await token({ client_id: clientId }), 400, "unsupported_grant_type");
  });

  test.each(["code", "redirect_uri", "code_verifier", "resource"])("missing %s: 400 invalid_request", async (name) => {
    const code = await seedCode();
    const fields: Record<string, string> = { grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: VERIFIER, resource: RESOURCE };
    delete fields[name];
    await expectError(await token(fields), 400, "invalid_request");
    // the code was not reached: it is still good
    expect((await exchange(code)).status).toBe(200);
  });

  test("wrong resource: 400 invalid_target, checked before the code", async () => {
    const code = await seedCode();
    await expectError(await exchange(code, { resource: `${BASE}/other` }), 400, "invalid_target");
    expect((await exchange(code)).status).toBe(200);
  });

  test("the client is checked before the parameters", async () => {
    await expectError(await token({ grant_type: "authorization_code", client_id: "nope" }), 401, "invalid_client");
  });

  test("unknown code", async () => {
    await expectError(await exchange("nope"), 400, "invalid_grant");
  });

  test("a used code is refused and gives no token", async () => {
    const code = await seedCode();
    expect((await exchange(code)).status).toBe(200);
    await expectError(await exchange(code), 400, "invalid_grant");
    expect((await env.DB.prepare("SELECT count(*) AS n FROM oauth_tokens").first<{ n: number }>())!.n).toBe(2);
  });

  test("an expired code", async () => {
    await expectError(await exchange(await seedCode({ expiresInMs: -1000 })), 400, "invalid_grant");
  });

  test.each([
    ["wrong verifier", { code_verifier: "other" }],
    ["another redirect_uri", { redirect_uri: `${REDIRECT}/` }],
    ["another client", {}],
  ])("%s: invalid_grant, and the code is used up by the failed exchange", async (name, over) => {
    const other = await registerClient();
    const code = await seedCode({ client: name === "another client" ? other : clientId });
    await expectError(await exchange(code, over), 400, "invalid_grant");
    await expectError(await exchange(code), 400, "invalid_grant");
    expect((await env.DB.prepare("SELECT count(*) AS n FROM oauth_tokens").first<{ n: number }>())!.n).toBe(0);
  });

  test.each([
    ["JSON", "application/json", JSON.stringify({ grant_type: "authorization_code" })],
    ["text", "text/plain", "grant_type=refresh_token"],
    ["no content type", "", "grant_type=refresh_token"],
    ["a longer media type", "application/x-www-form-urlencoded-foo", "grant_type=refresh_token"],
  ])("a body that is not form-encoded (%s): 400 invalid_request", async (_n, type, body) => {
    await expectError(await call("/token", { method: "POST", headers: type === "" ? {} : { "Content-Type": type }, body }), 400, "invalid_request");
  });

  test("GET /token is not found", async () => {
    expect((await call("/token")).status).toBe(404);
  });
});

describe("POST /token, refresh_token (10.5)", () => {
  test("rotates both tokens and keeps earlier access tokens valid", async () => {
    const first = await login();
    const res = await refresh(first.refresh_token);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const second = (await res.json()) as Tokens;
    expect(second.access_token).not.toBe(first.access_token);
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(second).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "digest" });
    const families = await env.DB.prepare("SELECT DISTINCT family_id FROM oauth_tokens").all();
    expect(families.results).toHaveLength(1);
    expect(await checkAccessToken(env, first.access_token)).toMatchObject({ userSub: "sub-bob" });
    expect(await checkAccessToken(env, second.access_token)).toMatchObject({ userSub: "sub-bob" });
    expect((await refresh(second.refresh_token, { resource: RESOURCE })).status).toBe(200);
  });

  test("a wrong resource is invalid_target, an unknown client invalid_client, a missing token invalid_request", async () => {
    const { refresh_token } = await login();
    await expectError(await refresh(refresh_token, { resource: `${BASE}/other` }), 400, "invalid_target");
    await expectError(await refresh(refresh_token, { client_id: "nope" }), 401, "invalid_client");
    await expectError(await token({ grant_type: "refresh_token", client_id: clientId }), 400, "invalid_request");
    expect((await refresh(refresh_token)).status).toBe(200);
  });

  test("the reuse of a used refresh token is invalid_grant and revokes the whole family", async () => {
    const first = await login();
    const second = (await (await refresh(first.refresh_token)).json()) as Tokens;
    await expectError(await refresh(first.refresh_token), 400, "invalid_grant");
    expect(await checkAccessToken(env, first.access_token)).toEqual({ reason: "revoked" });
    expect(await checkAccessToken(env, second.access_token)).toEqual({ reason: "revoked" });
    await expectError(await refresh(second.refresh_token), 400, "invalid_grant");
  });

  test("another family is left alone by a reuse", async () => {
    const mine = await login();
    const other = await login();
    await refresh(mine.refresh_token);
    await refresh(mine.refresh_token);
    expect(await checkAccessToken(env, other.access_token)).toMatchObject({ userSub: "sub-bob" });
    expect((await refresh(other.refresh_token)).status).toBe(200);
  });

  test("unknown, expired, revoked and foreign refresh tokens are invalid_grant", async () => {
    await expectError(await refresh("nope"), 400, "invalid_grant");

    const expired = await login();
    await env.DB.prepare("UPDATE oauth_tokens SET expires_at = ? WHERE token_hash = ?").bind(new Date(Date.now() - 1000).toISOString(), await sha256Hex(expired.refresh_token)).run();
    await expectError(await refresh(expired.refresh_token), 400, "invalid_grant");

    const revoked = await login();
    await env.DB.prepare("UPDATE oauth_tokens SET revoked_at = ? WHERE token_hash = ?").bind(new Date().toISOString(), await sha256Hex(revoked.refresh_token)).run();
    await expectError(await refresh(revoked.refresh_token), 400, "invalid_grant");

    const foreign = await login();
    await expectError(await refresh(foreign.refresh_token, { client_id: await registerClient() }), 400, "invalid_grant");
    expect((await refresh(foreign.refresh_token)).status).toBe(200);

    await expectError(await refresh((await login()).access_token), 400, "invalid_grant");
  });
});

describe("ACCESS_TOKEN_TTL_SECONDS", () => {
  test("sets expires_in and the lifetime of the access token", async () => {
    const res = await worker.fetch(
      new Request(`${BASE}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
        body: new URLSearchParams({ grant_type: "authorization_code", code: await seedCode(), redirect_uri: REDIRECT, client_id: clientId, code_verifier: VERIFIER, resource: RESOURCE }),
      }),
      { ...env, ACCESS_TOKEN_TTL_SECONDS: "120" },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Tokens;
    expect(body.expires_in).toBe(120);
    const row = await env.DB.prepare("SELECT expires_at FROM oauth_tokens WHERE token_hash = ?").bind(await sha256Hex(body.access_token)).first<{ expires_at: string }>();
    const left = Date.parse(row!.expires_at) - Date.now();
    expect(left).toBeGreaterThan(100000);
    expect(left).toBeLessThanOrEqual(120000);
  });
});

describe("logs", () => {
  const events = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => String(c[0]));

  test("auth.token.issued by each grant, without any token", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const first = await login();
    const second = (await (await refresh(first.refresh_token)).json()) as Tokens;
    const lines = events(spy);
    const issued = lines.map((l) => JSON.parse(l) as { event: string; level: string; attrs: unknown }).filter((e) => e.event === "auth.token.issued");
    expect(issued.map((e) => e.attrs)).toEqual([
      { client_id: clientId, grant_type: "authorization_code" },
      { client_id: clientId, grant_type: "refresh_token" },
    ]);
    for (const t of [first.access_token, first.refresh_token, second.access_token, second.refresh_token]) {
      expect(lines.some((l) => l.includes(t))).toBe(false);
    }
  });

  test("auth.refresh.reuse_detected at warn, with the number of tokens revoked", async () => {
    const first = await login();
    const second = (await (await refresh(first.refresh_token)).json()) as Tokens;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await refresh(first.refresh_token);
    const lines = events(spy);
    const found = lines.map((l) => JSON.parse(l) as { event: string; level: string; attrs: unknown }).filter((e) => e.event === "auth.refresh.reuse_detected");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ level: "warn", attrs: { client_id: clientId, revoked: 4 } });
    for (const t of [first.access_token, first.refresh_token, second.access_token, second.refresh_token]) {
      expect(lines.some((l) => l.includes(t))).toBe(false);
    }
  });
});

describe("access token check (10.6)", () => {
  test("a valid access token is accepted", async () => {
    const { access_token } = await login();
    expect(await checkAccessToken(env, access_token)).toEqual({ userSub: "sub-bob", clientId, scope: "digest" });
  });

  test("no bearer, an unknown one, a refresh token and a node token are refused", async () => {
    const { refresh_token } = await login();
    expect(await checkAccessToken(env, null)).toEqual({ reason: "missing" });
    expect(await checkAccessToken(env, "nope")).toEqual({ reason: "unknown" });
    expect(await checkAccessToken(env, refresh_token)).toEqual({ reason: "unknown" });
    const node = (await (await ops("/ops/nodes", { owner_label: "n" })).json()) as { token: string };
    expect(await checkAccessToken(env, node.token)).toEqual({ reason: "unknown" });
  });

  test("an expired and a revoked access token are refused", async () => {
    const expired = await login();
    await env.DB.prepare("UPDATE oauth_tokens SET expires_at = ? WHERE token_hash = ?").bind(new Date(Date.now() - 1000).toISOString(), await sha256Hex(expired.access_token)).run();
    expect(await checkAccessToken(env, expired.access_token)).toEqual({ reason: "expired" });
    const revoked = await login();
    await env.DB.prepare("UPDATE oauth_tokens SET revoked_at = ? WHERE token_hash = ?").bind(new Date().toISOString(), await sha256Hex(revoked.access_token)).run();
    expect(await checkAccessToken(env, revoked.access_token)).toEqual({ reason: "revoked" });
  });

  test("a token bound to another resource is refused", async () => {
    const { access_token } = await login();
    await env.DB.prepare("UPDATE oauth_tokens SET resource = 'http://elsewhere/mcp'").run();
    expect(await checkAccessToken(env, access_token)).toEqual({ reason: "unknown" });
  });

  test("the token of a user whose invite was revoked is refused at once; the admin needs no invite", async () => {
    const { access_token } = await login();
    expect((await ops("/ops/invites/revoke", { email: "bob@test" })).status).toBe(200);
    expect(await checkAccessToken(env, access_token)).toEqual({ reason: "revoked" });

    await env.DB.prepare("INSERT INTO users (user_sub, email, role, created_at) VALUES ('sub-alice', 'alice@test', 'admin', ?)").bind(new Date().toISOString()).run();
    const admin = (await (await exchange(await seedCode({ userSub: "sub-alice" }))).json()) as Tokens;
    expect(await checkAccessToken(env, admin.access_token)).toMatchObject({ userSub: "sub-alice" });
  });
});
