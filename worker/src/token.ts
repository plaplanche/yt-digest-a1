import { randomToken, sha256, sha256Hex } from "./crypto.js";
import { json } from "./http.js";
import { log } from "./log.js";

const SCOPE = "digest";
const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 3600;
const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 2592000;

const resourceOf = (env: Cloudflare.Env): string => `${env.PUBLIC_URL.replace(/\/+$/, "")}/mcp`;

function seconds(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

const inSeconds = (n: number): string => new Date(Date.now() + n * 1000).toISOString();

const base64Url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

function oauthError(status: number, error: string, description: string): Response {
  return json({ error, error_description: description }, status);
}

const invalidGrant = (description: string): Response => oauthError(400, "invalid_grant", description);

interface Grant {
  clientId: string;
  userSub: string;
  familyId: string;
  scope: string;
  resource: string;
}

/** Issues an access and a refresh token of the family and answers 200 (section 10.5). */
async function issue(env: Cloudflare.Env, grant: Grant, grantType: string): Promise<Response> {
  const accessTtl = seconds(env.ACCESS_TOKEN_TTL_SECONDS, DEFAULT_ACCESS_TOKEN_TTL_SECONDS);
  const access = randomToken();
  const refresh = randomToken();
  const insert = "INSERT INTO oauth_tokens (token_hash, kind, client_id, user_sub, family_id, scope, resource, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
  await env.DB.batch([
    env.DB.prepare(insert).bind(await sha256Hex(access), "access", grant.clientId, grant.userSub, grant.familyId, grant.scope, grant.resource, inSeconds(accessTtl)),
    env.DB.prepare(insert).bind(
      await sha256Hex(refresh),
      "refresh",
      grant.clientId,
      grant.userSub,
      grant.familyId,
      grant.scope,
      grant.resource,
      inSeconds(seconds(env.REFRESH_TOKEN_TTL_SECONDS, DEFAULT_REFRESH_TOKEN_TTL_SECONDS)),
    ),
  ]);
  log("auth.token.issued", { attrs: { client_id: grant.clientId, grant_type: grantType } });
  const res = json({ access_token: access, token_type: "Bearer", expires_in: accessTtl, refresh_token: refresh, scope: SCOPE });
  res.headers.set("Cache-Control", "no-store");
  return res;
}

interface CodeRow {
  client_id: string;
  user_sub: string;
  redirect_uri: string;
  code_challenge: string;
  scope: string;
  resource: string;
  expires_at: string;
}

async function authorizationCode(env: Cloudflare.Env, form: FormData, clientId: string): Promise<Response> {
  const [code, redirectUri, verifier, resource] = ["code", "redirect_uri", "code_verifier", "resource"].map((name) => form.get(name));
  if ([code, redirectUri, verifier, resource].some((v) => typeof v !== "string" || v === "")) return oauthError(400, "invalid_request", "A parameter is missing");
  if (resource !== resourceOf(env)) return oauthError(400, "invalid_target", "Unknown resource");

  // The code is used up here, whatever the checks below say.
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    "UPDATE oauth_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL RETURNING client_id, user_sub, redirect_uri, code_challenge, scope, resource, expires_at",
  )
    .bind(now, await sha256Hex(code as string))
    .first<CodeRow>();
  if (row === null) return invalidGrant("Unknown or already used code");
  if (row.expires_at <= now) return invalidGrant("Expired code");
  if (row.client_id !== clientId) return invalidGrant("Code issued to another client");
  if (row.redirect_uri !== redirectUri) return invalidGrant("Another redirect_uri");
  if (base64Url(await sha256(verifier as string)) !== row.code_challenge) return invalidGrant("Wrong code_verifier");
  return issue(env, { clientId, userSub: row.user_sub, familyId: randomToken(), scope: row.scope, resource: row.resource }, "authorization_code");
}

interface RefreshRow {
  client_id: string;
  user_sub: string;
  family_id: string;
  scope: string;
  resource: string;
}

async function refreshToken(env: Cloudflare.Env, form: FormData, clientId: string): Promise<Response> {
  const token = form.get("refresh_token");
  if (typeof token !== "string" || token === "") return oauthError(400, "invalid_request", "A parameter is missing");
  const resource = form.get("resource");
  if (resource !== null && resource !== resourceOf(env)) return oauthError(400, "invalid_target", "Unknown resource");

  const hash = await sha256Hex(token);
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `UPDATE oauth_tokens SET used_at = ?1
       WHERE token_hash = ?2 AND kind = 'refresh' AND client_id = ?3 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?1
       RETURNING client_id, user_sub, family_id, scope, resource`,
  )
    .bind(now, hash, clientId)
    .first<RefreshRow>();
  if (row !== null) {
    return issue(env, { clientId, userSub: row.user_sub, familyId: row.family_id, scope: row.scope, resource: row.resource }, "refresh_token");
  }

  const known = await env.DB.prepare("SELECT family_id, used_at FROM oauth_tokens WHERE token_hash = ? AND kind = 'refresh' AND client_id = ?")
    .bind(hash, clientId)
    .first<{ family_id: string; used_at: string | null }>();
  if (known !== null && known.used_at !== null) {
    const revoked = await env.DB.prepare("UPDATE oauth_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL").bind(now, known.family_id).run();
    log("auth.refresh.reuse_detected", { level: "warn", attrs: { client_id: clientId, revoked: revoked.meta.changes } });
  }
  return invalidGrant("Unknown, expired, revoked or used refresh token");
}

/** `POST /token` (section 10.5). */
export async function token(request: Request, env: Cloudflare.Env): Promise<Response> {
  let form: FormData;
  if ((request.headers.get("Content-Type") ?? "").split(";")[0]!.trim().toLowerCase() !== "application/x-www-form-urlencoded") {
    return oauthError(400, "invalid_request", "The body must be form-encoded");
  }
  try {
    form = await request.formData();
  } catch {
    return oauthError(400, "invalid_request", "Unreadable form");
  }
  const grantType = form.get("grant_type");
  if (grantType !== "authorization_code" && grantType !== "refresh_token") return oauthError(400, "unsupported_grant_type", "Unsupported grant_type");
  const clientId = form.get("client_id");
  const client = typeof clientId === "string" ? await env.DB.prepare("SELECT 1 AS ok FROM oauth_clients WHERE client_id = ?").bind(clientId).first() : null;
  if (typeof clientId !== "string" || client === null) return oauthError(401, "invalid_client", "Unknown client");
  return grantType === "authorization_code" ? authorizationCode(env, form, clientId) : refreshToken(env, form, clientId);
}

export interface AccessGrant {
  userSub: string;
  clientId: string;
  scope: string;
}

/** Section 10.6: the grant behind a bearer, or the reason it is refused. The user's admission is read again at each call. */
export async function checkAccessToken(env: Cloudflare.Env, bearer: string | null): Promise<AccessGrant | { reason: "missing" | "unknown" | "expired" | "revoked" }> {
  if (bearer === null || bearer === "") return { reason: "missing" };
  const row = await env.DB.prepare(
    `SELECT t.client_id, t.user_sub, t.scope, t.expires_at, t.revoked_at, u.email AS email
       FROM oauth_tokens t LEFT JOIN users u ON u.user_sub = t.user_sub
       WHERE t.token_hash = ? AND t.kind = 'access' AND t.resource = ?`,
  )
    .bind(await sha256Hex(bearer), resourceOf(env))
    .first<{ client_id: string; user_sub: string; scope: string; expires_at: string; revoked_at: string | null; email: string | null }>();
  if (row === null) return { reason: "unknown" };
  if (row.revoked_at !== null) return { reason: "revoked" };
  if (row.expires_at <= new Date().toISOString()) return { reason: "expired" };
  const invited =
    row.email !== null &&
    (row.email === env.ADMIN_EMAIL.toLowerCase() || (await env.DB.prepare("SELECT 1 AS ok FROM invites WHERE email = ? AND revoked = 0").bind(row.email).first()) !== null);
  return invited ? { userSub: row.user_sub, clientId: row.client_id, scope: row.scope } : { reason: "revoked" };
}
