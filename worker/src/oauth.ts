import { encryptSecret, randomToken, sha256Hex } from "./crypto.js";
import { json } from "./http.js";
import { log } from "./log.js";
import { token } from "./token.js";

const SCOPE = "digest";
const GOOGLE_SCOPE = "openid email https://www.googleapis.com/auth/youtube.readonly";
const DEFAULT_AUTH_CODE_TTL_SECONDS = 60;
const DEFAULT_AUTH_REQUEST_TTL_SECONDS = 600;

const base = (env: Cloudflare.Env): string => env.PUBLIC_URL.replace(/\/+$/, "");

function seconds(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

const inSeconds = (n: number): string => new Date(Date.now() + n * 1000).toISOString();

const escapeHtml = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

function html(status: number, title: string, body: string): Response {
  const page = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>\n${body}\n</body></html>\n`;
  return new Response(page, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

const errorPage = (status: number, message: string): Response => html(status, "Error", `<h1>Error</h1><p>${escapeHtml(message)}</p>`);

/** OAuth error body of section 10 (RFC 6749 / 7591). */
function oauthError(status: number, error: string, description: string): Response {
  return json({ error, error_description: description }, status);
}

/** 302 to the client with the given parameters and the client's `state` when it sent one. */
function redirectToClient(redirectUri: string, params: Record<string, string>, state: string | null): Response {
  const url = new URL(redirectUri);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  if (state !== null) url.searchParams.set("state", state);
  return new Response(null, { status: 302, headers: { Location: url.toString() } });
}

// 10.1

function discovery(env: Cloudflare.Env, path: string): Response | null {
  const BASE = base(env);
  if (path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp") {
    return json({ resource: `${BASE}/mcp`, authorization_servers: [BASE], scopes_supported: [SCOPE], bearer_methods_supported: ["header"] });
  }
  if (path === "/.well-known/oauth-authorization-server") {
    return json({
      issuer: BASE,
      authorization_endpoint: `${BASE}/authorize`,
      token_endpoint: `${BASE}/token`,
      registration_endpoint: `${BASE}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [SCOPE],
    });
  }
  return null;
}

// 10.2

function validRedirectUri(uri: unknown): boolean {
  if (typeof uri !== "string" || uri.includes("#")) return false;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
}

const isSubset = (value: unknown, allowed: string[]): boolean => Array.isArray(value) && value.every((v) => typeof v === "string" && allowed.includes(v));

async function register(request: Request, env: Cloudflare.Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return oauthError(400, "invalid_request", "Body is not JSON");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return oauthError(400, "invalid_request", "Body must be an object");
  const { redirect_uris: uris, client_name: name, token_endpoint_auth_method: method, grant_types: grants, response_types: responses } = body as Record<string, unknown>;
  if (!Array.isArray(uris) || uris.length < 1 || uris.length > 10 || !uris.every(validRedirectUri)) {
    return oauthError(400, "invalid_redirect_uri", "redirect_uris must hold 1 to 10 valid redirect URIs");
  }
  if (name !== undefined && (typeof name !== "string" || name.length > 200)) return oauthError(400, "invalid_client_metadata", "client_name must be at most 200 characters");
  if (method !== undefined && method !== "none") return oauthError(400, "invalid_client_metadata", "token_endpoint_auth_method must be none");
  if (grants !== undefined && !isSubset(grants, ["authorization_code", "refresh_token"])) return oauthError(400, "invalid_client_metadata", "Unsupported grant_types");
  if (responses !== undefined && !isSubset(responses, ["code"])) return oauthError(400, "invalid_client_metadata", "Unsupported response_types");

  const clientId = randomToken();
  const now = new Date();
  await env.DB.prepare("INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES (?, ?, ?, ?)")
    .bind(clientId, name ?? null, JSON.stringify(uris), now.toISOString())
    .run();
  log("auth.client.registered", { attrs: { client_id: clientId } });
  return json(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(now.getTime() / 1000),
      ...(name === undefined ? {} : { client_name: name }),
      redirect_uris: uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    201,
  );
}

// 10.3

interface PendingRequest {
  client_id: string;
  redirect_uri: string;
  client_state: string | null;
  code_challenge: string;
  scope: string;
  resource: string;
  google_nonce: string | null;
}

async function authorize(url: URL, env: Cloudflare.Env): Promise<Response> {
  const q = url.searchParams;
  const clientId = q.get("client_id");
  const client =
    clientId === null ? null : await env.DB.prepare("SELECT client_name, redirect_uris FROM oauth_clients WHERE client_id = ?").bind(clientId).first<{ client_name: string | null; redirect_uris: string }>();
  if (client === null || clientId === null) return errorPage(400, "Unknown client.");
  const redirectUri = q.get("redirect_uri");
  if (redirectUri === null || !(JSON.parse(client.redirect_uris) as string[]).includes(redirectUri)) return errorPage(400, "The redirect URI is not registered for this client.");

  const state = q.get("state");
  const fail = (error: string): Response => redirectToClient(redirectUri, { error }, state);
  const challenge = q.get("code_challenge");
  const scope = q.get("scope") ?? SCOPE;
  if (q.get("response_type") !== "code") return fail("unsupported_response_type");
  if (challenge === null || challenge === "" || q.get("code_challenge_method") !== "S256") return fail("invalid_request");
  if (q.get("resource") !== `${base(env)}/mcp`) return fail("invalid_target");
  if (scope !== SCOPE) return fail("invalid_scope");

  const requestId = randomToken();
  await env.DB.prepare(
    "INSERT INTO oauth_requests (request_id, client_id, redirect_uri, client_state, code_challenge, scope, resource, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(requestId, clientId, redirectUri, state, challenge, scope, `${base(env)}/mcp`, inSeconds(seconds(env.AUTH_REQUEST_TTL_SECONDS, DEFAULT_AUTH_REQUEST_TTL_SECONDS)))
    .run();
  return html(
    200,
    "Authorize access",
    `<h1>Authorize access</h1>
<p><strong>${escapeHtml(client.client_name ?? clientId)}</strong> asks to access your yt-digest account.</p>
<ul><li>Redirect URI: ${escapeHtml(redirectUri)}</li><li>Scope: ${escapeHtml(scope)}</li></ul>
<form method="post" action="/authorize/consent">
<input type="hidden" name="request" value="${escapeHtml(requestId)}">
<button type="submit" name="decision" value="approve">Approve</button>
<button type="submit" name="decision" value="deny">Deny</button>
</form>`,
  );
}

async function googleDiscovery(env: Cloudflare.Env): Promise<{ authorization_endpoint: string; token_endpoint: string; jwks_uri: string } | null> {
  try {
    const res = await fetch(`${env.GOOGLE_ISSUER.replace(/\/+$/, "")}/.well-known/openid-configuration`);
    if (!res.ok) return null;
    const doc = (await res.json()) as Record<string, unknown>;
    const { authorization_endpoint: a, token_endpoint: t, jwks_uri: j } = doc;
    return typeof a === "string" && typeof t === "string" && typeof j === "string" ? { authorization_endpoint: a, token_endpoint: t, jwks_uri: j } : null;
  } catch {
    return null;
  }
}

async function consent(request: Request, env: Cloudflare.Env): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorPage(400, "Unreadable form.");
  }
  const requestId = form.get("request");
  const decision = form.get("decision");
  if (typeof requestId !== "string" || (decision !== "approve" && decision !== "deny")) return errorPage(400, "Invalid consent request.");
  const now = new Date().toISOString();
  const live = "request_id = ?1 AND used_at IS NULL AND expires_at > ?2";

  if (decision === "deny") {
    const row = await env.DB.prepare(`UPDATE oauth_requests SET used_at = ?2 WHERE ${live} RETURNING client_id, redirect_uri, client_state`)
      .bind(requestId, now)
      .first<{ client_id: string; redirect_uri: string; client_state: string | null }>();
    if (row === null) return errorPage(400, "Unknown, expired or already used request.");
    log("auth.oauth.denied", { attrs: { client_id: row.client_id, reason: "access_denied" } });
    return redirectToClient(row.redirect_uri, { error: "access_denied" }, row.client_state);
  }

  const googleState = randomToken();
  const nonce = randomToken();
  const row = await env.DB.prepare(`UPDATE oauth_requests SET google_state = ?3, google_nonce = ?4 WHERE ${live} RETURNING request_id`)
    .bind(requestId, now, googleState, nonce)
    .first();
  if (row === null) return errorPage(400, "Unknown, expired or already used request.");
  const doc = await googleDiscovery(env);
  if (doc === null) return errorPage(502, "The identity provider is unavailable.");
  const target = new URL(doc.authorization_endpoint);
  target.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${base(env)}/callback`,
    response_type: "code",
    scope: GOOGLE_SCOPE,
    state: googleState,
    nonce,
    access_type: "offline",
    prompt: "consent",
  }).toString();
  return new Response(null, { status: 302, headers: { Location: target.toString() } });
}

// 10.4

const decodeBase64Url = (text: string): Uint8Array<ArrayBuffer> => {
  const padded = text.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
};

const decodeJson = (part: string): Record<string, unknown> => JSON.parse(new TextDecoder().decode(decodeBase64Url(part))) as Record<string, unknown>;

interface IdClaims {
  sub: string;
  email: string;
  email_verified: unknown;
}

/** The claims of an ID token that passes the checks of 10.4 step 3, else null. */
async function verifyIdToken(env: Cloudflare.Env, idToken: string, jwksUri: string, nonce: string | null): Promise<IdClaims | null> {
  try {
    const parts = idToken.split(".");
    if (parts.length !== 3) return null;
    const [h, p, s] = parts as [string, string, string];
    const header = decodeJson(h);
    if (header["alg"] !== "RS256") return null;
    const jwks = (await (await fetch(jwksUri)).json()) as { keys: (JsonWebKey & { kid?: string })[] };
    const jwk = jwks.keys.find((k) => k.kid === header["kid"]);
    if (jwk === undefined) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, decodeBase64Url(s), new TextEncoder().encode(`${h}.${p}`));
    if (!valid) return null;
    const claims = decodeJson(p);
    const { iss, aud, exp, sub, email } = claims;
    if (iss !== env.GOOGLE_ISSUER || aud !== env.GOOGLE_CLIENT_ID) return null;
    if (typeof exp !== "number" || exp * 1000 <= Date.now()) return null;
    if (nonce === null || claims["nonce"] !== nonce) return null;
    if (typeof sub !== "string" || typeof email !== "string") return null;
    return { sub, email, email_verified: claims["email_verified"] };
  } catch {
    return null;
  }
}

/** Exchanges the code at Google (step 3): the verified claims and the refresh token, or null. */
async function googleLogin(env: Cloudflare.Env, code: string | null, nonce: string | null): Promise<{ claims: IdClaims; refreshToken: string | null } | null> {
  const doc = await googleDiscovery(env);
  if (doc === null || code === null) return null;
  try {
    const res = await fetch(doc.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: `${base(env)}/callback`,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
      }),
    });
    if (!res.ok) return null;
    const tokens = (await res.json()) as Record<string, unknown>;
    if (typeof tokens["id_token"] !== "string") return null;
    const claims = await verifyIdToken(env, tokens["id_token"], doc.jwks_uri, nonce);
    if (claims === null) return null;
    return { claims, refreshToken: typeof tokens["refresh_token"] === "string" ? tokens["refresh_token"] : null };
  } catch {
    return null;
  }
}

const refusalPage = (): Response => html(403, "Access refused", "<h1>Access refused</h1><p>This account is not invited.</p>");

async function callback(url: URL, env: Cloudflare.Env): Promise<Response> {
  const state = url.searchParams.get("state");
  if (state === null || state === "") return errorPage(400, "Unknown, expired or already used request.");
  const pending = await env.DB.prepare(
    `UPDATE oauth_requests SET used_at = ?2 WHERE google_state = ?1 AND used_at IS NULL AND expires_at > ?2
       RETURNING client_id, redirect_uri, client_state, code_challenge, scope, resource, google_nonce`,
  )
    .bind(state, new Date().toISOString())
    .first<PendingRequest>();
  if (pending === null) return errorPage(400, "Unknown, expired or already used request.");
  const clientId = pending.client_id;

  if (url.searchParams.has("error")) {
    log("auth.oauth.denied", { attrs: { client_id: clientId, reason: "access_denied" } });
    return redirectToClient(pending.redirect_uri, { error: "access_denied" }, pending.client_state);
  }
  const login = await googleLogin(env, url.searchParams.get("code"), pending.google_nonce);
  if (login === null) {
    log("auth.oauth.denied", { level: "warn", attrs: { client_id: clientId, reason: "google_error" } });
    return redirectToClient(pending.redirect_uri, { error: "server_error" }, pending.client_state);
  }

  const { claims, refreshToken } = login;
  const email = claims.email.toLowerCase();
  const invite = await env.DB.prepare("SELECT 1 AS ok FROM invites WHERE email = ? AND revoked = 0").bind(email).first();
  const role = email === env.ADMIN_EMAIL.toLowerCase() ? "admin" : invite !== null ? "member" : null;
  if (claims.email_verified !== true || role === null) {
    log("auth.oauth.denied", { level: "warn", attrs: { client_id: clientId, reason: claims.email_verified !== true ? "email_unverified" : "not_invited" } });
    return refusalPage();
  }

  const now = new Date().toISOString();
  const code = randomToken();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (user_sub, email, role, google_refresh_token_enc, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (user_sub) DO UPDATE SET email = ?2, role = ?3, google_refresh_token_enc = COALESCE(?4, google_refresh_token_enc)`,
    ).bind(claims.sub, email, role, refreshToken === null ? null : await encryptSecret(refreshToken, env.TOKEN_ENC_KEY), now),
    env.DB.prepare("UPDATE invites SET accepted_user_sub = ? WHERE email = ?").bind(claims.sub, email),
    env.DB.prepare(
      "INSERT INTO oauth_codes (code_hash, client_id, user_sub, redirect_uri, code_challenge, scope, resource, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(await sha256Hex(code), clientId, claims.sub, pending.redirect_uri, pending.code_challenge, pending.scope, pending.resource, inSeconds(seconds(env.AUTH_CODE_TTL_SECONDS, DEFAULT_AUTH_CODE_TTL_SECONDS))),
  ]);
  log("auth.oauth.completed", { attrs: { client_id: clientId, role } });
  return redirectToClient(pending.redirect_uri, { code }, pending.client_state);
}

/** Handles the OAuth routes of sections 10.1 to 10.5; null when the path is none of them. */
export async function handleOAuth(request: Request, env: Cloudflare.Env, path: string): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method === "GET") {
    const doc = discovery(env, path);
    if (doc !== null) return doc;
    if (path === "/authorize") return authorize(url, env);
    if (path === "/callback") return callback(url, env);
  }
  if (request.method === "POST" && path === "/token") return token(request, env);
  if (request.method === "POST" && path === "/register") return register(request, env);
  if (request.method === "POST" && path === "/authorize/consent") return consent(request, env);
  return null;
}
