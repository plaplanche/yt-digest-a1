import { encryptSecret, randomToken, sha256Hex } from "./crypto.js";
import { json } from "./http.js";
import { log } from "./log.js";

const SCOPE = "digest";
const GOOGLE_SCOPE = "openid email https://www.googleapis.com/auth/youtube.readonly";
const CLIENT_GRANTS = ["authorization_code", "refresh_token"];

const base = (env: Cloudflare.Env): string => env.PUBLIC_URL.replace(/\/+$/, "");

function ttl(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

const inSeconds = (seconds: number): string => new Date(Date.now() + seconds * 1000).toISOString();

const oauthError = (status: number, error: string, description?: string): Response =>
  json(description === undefined ? { error } : { error, error_description: description }, status);

const escapeHtml = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

function html(status: number, title: string, body: string): Response {
  const page = `<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>${body}</body></html>\n`;
  return new Response(page, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

const errorPage = (message: string): Response => html(400, "Authorization error", `<h1>Authorization error</h1><p>${escapeHtml(message)}</p>`);

function redirect(location: string, params: Record<string, string | undefined>): Response {
  const url = new URL(location);
  for (const [name, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(name, value);
  return new Response(null, { status: 302, headers: { Location: url.toString() } });
}

/** 10.1 */
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
      grant_types_supported: CLIENT_GRANTS,
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [SCOPE],
    });
  }
  return null;
}

function validRedirectUri(value: unknown): boolean {
  if (typeof value !== "string" || value.includes("#")) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
}

const subsetOf = (value: unknown, allowed: string[]): boolean => Array.isArray(value) && value.every((v) => typeof v === "string" && allowed.includes(v));

/** 10.2 */
async function register(request: Request, env: Cloudflare.Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return oauthError(400, "invalid_request", "Body is not JSON");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return oauthError(400, "invalid_request", "Body must be an object");
  const meta = body as Record<string, unknown>;
  const uris = meta["redirect_uris"];
  if (!Array.isArray(uris) || uris.length < 1 || uris.length > 10 || !uris.every(validRedirectUri)) {
    return oauthError(400, "invalid_redirect_uri", "redirect_uris must hold 1 to 10 valid redirect URIs");
  }
  const name = meta["client_name"];
  if (name !== undefined && (typeof name !== "string" || name.length > 200)) return oauthError(400, "invalid_client_metadata", "client_name must be at most 200 characters");
  if (meta["token_endpoint_auth_method"] !== undefined && meta["token_endpoint_auth_method"] !== "none") {
    return oauthError(400, "invalid_client_metadata", "token_endpoint_auth_method must be none");
  }
  if (meta["grant_types"] !== undefined && !subsetOf(meta["grant_types"], CLIENT_GRANTS)) {
    return oauthError(400, "invalid_client_metadata", "grant_types must be a subset of authorization_code, refresh_token");
  }
  if (meta["response_types"] !== undefined && !subsetOf(meta["response_types"], ["code"])) {
    return oauthError(400, "invalid_client_metadata", "response_types must be code");
  }
  const clientId = randomToken().slice(0, 32);
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
      grant_types: CLIENT_GRANTS,
      response_types: ["code"],
    },
    201,
  );
}

/** 10.3 */
async function authorize(url: URL, env: Cloudflare.Env): Promise<Response> {
  const q = url.searchParams;
  const clientId = q.get("client_id");
  const redirectUri = q.get("redirect_uri");
  const client = clientId === null ? null : await env.DB.prepare("SELECT client_name, redirect_uris FROM oauth_clients WHERE client_id = ?").bind(clientId).first<{ client_name: string | null; redirect_uris: string }>();
  if (client === null || clientId === null) return errorPage("Unknown client.");
  if (redirectUri === null || !(JSON.parse(client.redirect_uris) as string[]).includes(redirectUri)) return errorPage("The redirect URI is not registered for this client.");
  const state = q.get("state") ?? undefined;
  const fail = (error: string): Response => redirect(redirectUri, { error, state });
  if (q.get("response_type") !== "code") return fail("unsupported_response_type");
  const challenge = q.get("code_challenge");
  if (challenge === null || challenge === "" || q.get("code_challenge_method") !== "S256") return fail("invalid_request");
  const resource = q.get("resource");
  if (resource !== `${base(env)}/mcp`) return fail("invalid_target");
  const scope = q.get("scope") ?? SCOPE;
  if (scope !== SCOPE) return fail("invalid_scope");

  const requestId = randomToken();
  await env.DB.prepare(
    "INSERT INTO oauth_requests (request_id, client_id, redirect_uri, client_state, code_challenge, scope, resource, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(requestId, clientId, redirectUri, state ?? null, challenge, scope, resource, inSeconds(ttl(env.AUTH_REQUEST_TTL_SECONDS, 600)))
    .run();
  const display = escapeHtml(client.client_name ?? clientId);
  return html(
    200,
    "Authorize access",
    `<h1>Authorize access</h1><p><strong>${display}</strong> wants access to your yt-digest account.</p>` +
      `<p>Redirect URI: <code>${escapeHtml(redirectUri)}</code></p><p>Scope: <code>${escapeHtml(scope)}</code></p>` +
      `<form method="post" action="/authorize/consent"><input type="hidden" name="request" value="${escapeHtml(requestId)}">` +
      `<button type="submit" name="decision" value="approve">Approve</button> <button type="submit" name="decision" value="deny">Deny</button></form>`,
  );
}

interface PendingRequest {
  request_id: string;
  client_id: string;
  redirect_uri: string;
  client_state: string | null;
  code_challenge: string;
  scope: string | null;
  resource: string | null;
}

const PENDING_COLUMNS = "request_id, client_id, redirect_uri, client_state, code_challenge, scope, resource";

/** 10.3, `POST /authorize/consent` */
async function consent(request: Request, env: Cloudflare.Env): Promise<Response> {
  const form = await request.formData().catch(() => null);
  const id = form?.get("request");
  const decision = form?.get("decision");
  const now = new Date().toISOString();
  const pending =
    typeof id === "string"
      ? await env.DB.prepare(`SELECT ${PENDING_COLUMNS} FROM oauth_requests WHERE request_id = ? AND used_at IS NULL AND expires_at > ?`).bind(id, now).first<PendingRequest>()
      : null;
  if (pending === null || typeof id !== "string") return errorPage("This authorization request is unknown, expired or already used.");
  if (decision === "deny") {
    const res = await env.DB.prepare("UPDATE oauth_requests SET used_at = ? WHERE request_id = ? AND used_at IS NULL").bind(now, id).run();
    if (res.meta.changes === 0) return errorPage("This authorization request is unknown, expired or already used.");
    log("auth.oauth.denied", { attrs: { client_id: pending.client_id, reason: "access_denied" } });
    return redirect(pending.redirect_uri, { error: "access_denied", state: pending.client_state ?? undefined });
  }
  if (decision !== "approve") return errorPage("Choose approve or deny.");

  const googleState = randomToken();
  const nonce = randomToken();
  const res = await env.DB.prepare("UPDATE oauth_requests SET google_state = ?, google_nonce = ? WHERE request_id = ? AND used_at IS NULL")
    .bind(googleState, nonce, id)
    .run();
  if (res.meta.changes === 0) return errorPage("This authorization request is unknown, expired or already used.");
  const config = await googleConfig(env);
  if (config === null) return html(502, "Login unavailable", "<h1>Login unavailable</h1><p>The identity provider could not be reached.</p>");
  return redirect(config.authorization_endpoint, {
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${base(env)}/callback`,
    response_type: "code",
    scope: GOOGLE_SCOPE,
    state: googleState,
    nonce,
    access_type: "offline",
    prompt: "consent",
  });
}

interface GoogleConfig {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

async function googleConfig(env: Cloudflare.Env): Promise<GoogleConfig | null> {
  try {
    const res = await fetch(`${env.GOOGLE_ISSUER.replace(/\/+$/, "")}/.well-known/openid-configuration`);
    if (!res.ok) return null;
    const doc = (await res.json()) as Partial<GoogleConfig>;
    if (typeof doc.authorization_endpoint !== "string" || typeof doc.token_endpoint !== "string" || typeof doc.jwks_uri !== "string") return null;
    return { authorization_endpoint: doc.authorization_endpoint, token_endpoint: doc.token_endpoint, jwks_uri: doc.jwks_uri };
  } catch {
    return null;
  }
}

interface IdClaims {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  nonce?: unknown;
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
}

const fromB64Url = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
const parsePart = (text: string): Record<string, unknown> => JSON.parse(new TextDecoder().decode(fromB64Url(text))) as Record<string, unknown>;

/** The checks of 10.4 step 3; returns the claims or null. */
async function verifyIdToken(token: string, jwksUri: string, nonce: string, env: Cloudflare.Env): Promise<IdClaims | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [h, p, s] = parts as [string, string, string];
    const header = parsePart(h);
    if (header["alg"] !== "RS256") return null;
    const jwks = (await (await fetch(jwksUri)).json()) as { keys?: (JsonWebKey & { kid?: string })[] };
    const jwk = jwks.keys?.find((k) => k.kid === header["kid"] && (k.alg === undefined || k.alg === "RS256"));
    if (jwk === undefined) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromB64Url(s), new TextEncoder().encode(`${h}.${p}`));
    if (!ok) return null;
    const claims = parsePart(p) as IdClaims;
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== env.GOOGLE_ISSUER || !aud.includes(env.GOOGLE_CLIENT_ID)) return null;
    if (typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now()) return null;
    if (claims.nonce !== nonce) return null;
    return claims;
  } catch {
    return null;
  }
}

/** 10.4 */
async function callback(url: URL, env: Cloudflare.Env): Promise<Response> {
  const state = url.searchParams.get("state");
  const now = new Date().toISOString();
  const pending =
    state === null || state === ""
      ? null
      : await env.DB.prepare(`SELECT ${PENDING_COLUMNS}, google_nonce FROM oauth_requests WHERE google_state = ? AND used_at IS NULL AND expires_at > ?`)
          .bind(state, now)
          .first<PendingRequest & { google_nonce: string }>();
  if (pending === null) return errorPage("This login request is unknown, expired or already used.");
  const used = await env.DB.prepare("UPDATE oauth_requests SET used_at = ? WHERE request_id = ? AND used_at IS NULL").bind(now, pending.request_id).run();
  if (used.meta.changes === 0) return errorPage("This login request is unknown, expired or already used.");

  const clientState = pending.client_state ?? undefined;
  const clientError = (error: string, reason: string): Response => {
    log("auth.oauth.denied", { attrs: { client_id: pending.client_id, reason } });
    return redirect(pending.redirect_uri, { error, state: clientState });
  };
  if (url.searchParams.has("error")) return clientError("access_denied", "access_denied");
  const code = url.searchParams.get("code");
  const config = await googleConfig(env);
  if (code === null || config === null) return clientError("server_error", "google_error");

  let tokens: { id_token?: unknown; refresh_token?: unknown };
  try {
    const res = await fetch(config.token_endpoint, {
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
    if (!res.ok) return clientError("server_error", "google_error");
    tokens = (await res.json()) as typeof tokens;
  } catch {
    return clientError("server_error", "google_error");
  }
  const claims = typeof tokens.id_token === "string" ? await verifyIdToken(tokens.id_token, config.jwks_uri, pending.google_nonce, env) : null;
  if (claims === null || typeof claims.sub !== "string" || typeof claims.email !== "string") return clientError("server_error", "google_error");

  const email = claims.email.toLowerCase();
  let role: "admin" | "member" | null = null;
  if (email === env.ADMIN_EMAIL.toLowerCase()) role = "admin";
  else if ((await env.DB.prepare("SELECT 1 AS ok FROM invites WHERE email = ? AND revoked = 0").bind(email).first()) !== null) role = "member";
  if (role === null || claims.email_verified !== true) {
    const reason = role === null ? "not_invited" : "email_unverified";
    log("auth.oauth.denied", { attrs: { client_id: pending.client_id, reason } });
    return html(
      403,
      "Access refused",
      `<h1>Access refused</h1><p>This account is not invited.</p><p>Ask the administrator for an invitation.</p>`,
    );
  }

  const encrypted = typeof tokens.refresh_token === "string" ? await encryptSecret(tokens.refresh_token, env.TOKEN_ENC_KEY) : null;
  const authCode = randomToken();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (user_sub, email, role, google_refresh_token_enc, created_at) VALUES (?, ?, ?, ?, ?) " +
        "ON CONFLICT (user_sub) DO UPDATE SET email = excluded.email, role = excluded.role, " +
        "google_refresh_token_enc = COALESCE(excluded.google_refresh_token_enc, users.google_refresh_token_enc)",
    ).bind(claims.sub, email, role, encrypted, now),
    env.DB.prepare("UPDATE invites SET accepted_user_sub = ? WHERE email = ?").bind(claims.sub, email),
    env.DB.prepare(
      "INSERT INTO oauth_codes (code_hash, client_id, user_sub, redirect_uri, code_challenge, scope, resource, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(await sha256Hex(authCode), pending.client_id, claims.sub, pending.redirect_uri, pending.code_challenge, pending.scope, pending.resource, inSeconds(ttl(env.AUTH_CODE_TTL_SECONDS, 60))),
  ]);
  log("auth.oauth.completed", { attrs: { client_id: pending.client_id, role } });
  return redirect(pending.redirect_uri, { code: authCode, state: clientState });
}

/** Routes of sections 10.1 to 10.4; null when the path is not one of them. */
export async function handleOAuth(request: Request, env: Cloudflare.Env, url: URL): Promise<Response | null> {
  const path = url.pathname;
  const get = request.method === "GET";
  if (get) {
    const doc = discovery(env, path);
    if (doc !== null) return doc;
    if (path === "/authorize") return authorize(url, env);
    if (path === "/callback") return callback(url, env);
  }
  if (request.method === "POST") {
    if (path === "/register") return register(request, env);
    if (path === "/authorize/consent") return consent(request, env);
  }
  return null;
}
