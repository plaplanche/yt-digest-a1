import { createHash, createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const port = Number(process.env.MOCKS_PORT ?? "8789");
const clientId = process.env.GOOGLE_CLIENT_ID ?? "yt-digest-local";
const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "local-google-secret";
const issuer = `http://127.0.0.1:${port}/google`;

const CODE_TTL_MS = 60_000;
const TOKEN_TTL_SECONDS = 3600;

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: randomBytes(8).toString("hex"), alg: "RS256", use: "sig" };

interface Grant {
  email: string;
  scope: string;
  nonce?: string;
}
const codes = new Map<string, Grant & { redirectUri: string; offline: boolean; expiresAt: number }>();
const accessTokens = new Map<string, { email: string; expiresAt: number }>();
const refreshTokens = new Map<string, Grant>();

const b64url = (data: Buffer | string): string => Buffer.from(data).toString("base64url");
const subject = (email: string): string => `g-${createHash("sha256").update(email).digest("hex").slice(0, 16)}`;

function idToken({ email, nonce }: Grant): string {
  const iat = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: jwk.kid }));
  const claims = { iss: issuer, aud: clientId, sub: subject(email), email, email_verified: true, iat, exp: iat + TOKEN_TTL_SECONDS, ...(nonce ? { nonce } : {}) };
  const signingInput = `${header}.${b64url(JSON.stringify(claims))}`;
  return `${signingInput}.${b64url(createSign("RSA-SHA256").update(signingInput).sign(privateKey))}`;
}

function send(res: ServerResponse, status: number, body: string, type: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": type, ...headers });
  res.end(body);
}
const sendJson = (res: ServerResponse, status: number, body: unknown): void => send(res, status, JSON.stringify(body), "application/json");
const sendText = (res: ServerResponse, status: number, body: string): void => send(res, status, body, "text/plain");

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function authorize(url: URL, res: ServerResponse): void {
  const q = url.searchParams;
  const redirectUri = q.get("redirect_uri");
  if (q.get("client_id") !== clientId) return sendText(res, 400, "Unknown client_id");
  if (!redirectUri) return sendText(res, 400, "Missing redirect_uri");
  if (q.get("response_type") !== "code") return sendText(res, 400, "response_type must be code");
  if (!(q.get("scope") ?? "").split(" ").includes("openid")) return sendText(res, 400, "scope must contain openid");
  const hint = q.get("login_hint");
  if (!hint) {
    const hidden = [...q].map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`).join("\n    ");
    const page = `<!doctype html>
<html><head><title>Sign in</title></head><body>
  <form method="get" action="/google/authorize">
    ${hidden}
    <input type="text" name="login_hint" placeholder="e-mail">
    <button type="submit">Sign in</button>
  </form>
</body></html>`;
    return send(res, 200, page, "text/html; charset=utf-8");
  }
  const code = randomBytes(24).toString("base64url");
  codes.set(code, {
    email: hint.toLowerCase(),
    scope: q.get("scope") ?? "",
    nonce: q.get("nonce") ?? undefined,
    redirectUri,
    offline: q.get("access_type") === "offline",
    expiresAt: Date.now() + CODE_TTL_MS,
  });
  const target = new URL(redirectUri);
  target.searchParams.set("code", code);
  const state = q.get("state");
  if (state !== null) target.searchParams.set("state", state);
  res.writeHead(302, { Location: target.toString() });
  res.end();
}

function authenticated(req: IncomingMessage, form: URLSearchParams): boolean {
  let id = form.get("client_id");
  let secret = form.get("client_secret");
  const basic = /^Basic (.+)$/.exec(req.headers.authorization ?? "")?.[1];
  if (basic !== undefined) {
    const decoded = Buffer.from(basic, "base64").toString("utf8");
    const colon = decoded.indexOf(":");
    if (colon >= 0) {
      id = decodeURIComponent(decoded.slice(0, colon));
      secret = decodeURIComponent(decoded.slice(colon + 1));
    }
  }
  return id === clientId && secret === clientSecret;
}

function issueAccess(grant: Grant): { access_token: string; token_type: string; expires_in: number; scope: string; id_token: string } {
  const accessToken = randomBytes(24).toString("base64url");
  accessTokens.set(accessToken, { email: grant.email, expiresAt: Date.now() + TOKEN_TTL_SECONDS * 1000 });
  return { access_token: accessToken, token_type: "Bearer", expires_in: TOKEN_TTL_SECONDS, scope: grant.scope, id_token: idToken(grant) };
}

async function token(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const form = await readForm(req);
  if (!authenticated(req, form)) return sendJson(res, 401, { error: "invalid_client" });
  const grantType = form.get("grant_type");
  if (grantType === "authorization_code") {
    const code = form.get("code") ?? "";
    const entry = codes.get(code);
    codes.delete(code);
    if (entry === undefined || entry.expiresAt < Date.now() || entry.redirectUri !== form.get("redirect_uri")) return sendJson(res, 400, { error: "invalid_grant" });
    const body: Record<string, unknown> = issueAccess(entry);
    if (entry.offline) {
      const refresh = randomBytes(24).toString("base64url");
      refreshTokens.set(refresh, { email: entry.email, scope: entry.scope });
      body.refresh_token = refresh;
    }
    return sendJson(res, 200, body);
  }
  if (grantType === "refresh_token") {
    const grant = refreshTokens.get(form.get("refresh_token") ?? "");
    if (grant === undefined) return sendJson(res, 400, { error: "invalid_grant" });
    return sendJson(res, 200, issueAccess({ email: grant.email, scope: grant.scope }));
  }
  sendJson(res, 400, { error: "invalid_grant" });
}

function userinfo(req: IncomingMessage, res: ServerResponse): void {
  const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
  const entry = bearer === undefined ? undefined : accessTokens.get(bearer);
  if (entry === undefined || entry.expiresAt < Date.now()) return sendText(res, 401, "Unauthorized");
  sendJson(res, 200, { sub: subject(entry.email), email: entry.email, email_verified: true });
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  const route = `${req.method} ${url.pathname}`;
  const handled = (async () => {
    switch (route) {
      case "GET /health":
        return sendJson(res, 200, { status: "ok" });
      case "GET /google/.well-known/openid-configuration":
        return sendJson(res, 200, {
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
      case "GET /google/authorize":
        return authorize(url, res);
      case "POST /google/token":
        return token(req, res);
      case "GET /google/userinfo":
        return userinfo(req, res);
      case "GET /google/jwks":
        return sendJson(res, 200, { keys: [jwk] });
      case "POST /google/revoke":
        req.resume();
        return sendText(res, 200, "");
      default:
        return sendText(res, 404, "Not Found");
    }
  })();
  handled.catch((error: unknown) => {
    console.error("mocks: request failed", error);
    if (!res.headersSent) sendText(res, 500, "Internal Server Error");
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`mocks: listening on http://127.0.0.1:${port}`);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.close(() => process.exit(0)));
