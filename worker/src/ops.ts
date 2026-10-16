import { errorResponse, json, notFound } from "./http.js";

/** Every table of section 6.3, children first is not needed: no foreign keys. */
const TABLES = [
  "nodes",
  "jobs",
  "leases",
  "node_events",
  "invites",
  "users",
  "oauth_clients",
  "oauth_requests",
  "oauth_codes",
  "oauth_tokens",
];

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/** Compares two secrets in constant time, by comparing their fixed-length digests. */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < da.length; i++) diff |= da[i]! ^ db[i]!;
  return diff === 0;
}

async function reset(env: Cloudflare.Env): Promise<Response> {
  await env.DB.batch(TABLES.map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
  let cursor: string | undefined;
  do {
    const page = await env.TRANSCRIPTS.list({ prefix: "transcripts/", cursor });
    if (page.objects.length > 0) await env.TRANSCRIPTS.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return json({ ok: true });
}

/** Handles `/ops/*`: 404 when disabled, 401 before anything else reads the request, then the route. */
export async function handleOps(request: Request, env: Cloudflare.Env, path: string): Promise<Response> {
  if (!env.OPS_TOKEN) return notFound();
  const bearer = /^Bearer (.+)$/.exec(request.headers.get("Authorization") ?? "")?.[1];
  if (bearer === undefined || !(await safeEqual(bearer, env.OPS_TOKEN))) {
    return errorResponse(401, "unauthorized", "Missing or wrong operator token");
  }
  if (request.method === "POST" && path === "/ops/reset") return reset(env);
  return notFound();
}
