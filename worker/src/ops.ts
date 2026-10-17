import { randomToken, sha256, sha256Hex } from "./crypto.js";
import { errorResponse, json, notFound } from "./http.js";
import { FAIL_SET, sweepExpiredLeases } from "./jobs.js";
import { log } from "./log.js";

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

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const NODE_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

const invalid = (message: string): Response => errorResponse(400, "invalid_request", message);

async function withBody(request: Request, handler: (body: Record<string, unknown>) => Promise<Response>): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalid("Body is not JSON");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return invalid("Body must be an object");
  return handler(body as Record<string, unknown>);
}

async function enrollNode(env: Cloudflare.Env, body: Record<string, unknown>): Promise<Response> {
  const { node_id: nodeId, owner_label: ownerLabel } = body;
  if (typeof nodeId !== "string" || !NODE_ID.test(nodeId)) return invalid("node_id must match ^[a-z0-9][a-z0-9-]{0,62}$");
  if (typeof ownerLabel !== "string" || ownerLabel.length < 1 || ownerLabel.length > 100) return invalid("owner_label must be 1 to 100 characters");
  const token = `ytd_node_${randomToken()}`;
  const now = new Date().toISOString();
  const res = await env.DB.prepare(
    "INSERT INTO nodes (node_id, owner_label, token_hash, state, state_since, created_at) VALUES (?, ?, ?, 'healthy', ?, ?) ON CONFLICT (node_id) DO NOTHING",
  )
    .bind(nodeId, ownerLabel, await sha256Hex(token), now, now)
    .run();
  if (res.meta.changes === 0) return errorResponse(409, "conflict", "Node already exists");
  log("node.enrolled", { attrs: { node_id: nodeId } });
  return json({ node_id: nodeId, owner_label: ownerLabel, token });
}

async function enqueueJobs(env: Cloudflare.Env, body: Record<string, unknown>): Promise<Response> {
  const { video_ids: ids, priority = 0 } = body;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100 || !ids.every((id) => typeof id === "string" && VIDEO_ID.test(id))) {
    return invalid("video_ids must be 1 to 100 video ids");
  }
  if (typeof priority !== "number" || !Number.isInteger(priority) || priority < 0) return invalid("priority must be an integer >= 0");
  const videoIds = [...new Set(ids as string[])];
  const now = new Date().toISOString();
  const results = await env.DB.batch([
    ...videoIds.map((id) =>
      env.DB.prepare("INSERT INTO jobs (video_id, kind, priority, status, created_at) VALUES (?, 'primary', ?, 'queued', ?) ON CONFLICT (video_id, kind) DO NOTHING").bind(id, priority, now),
    ),
    ...videoIds.map((id) => env.DB.prepare("UPDATE jobs SET priority = ?2 WHERE video_id = ?1 AND kind = 'primary' AND priority < ?2").bind(id, priority)),
  ]);
  const enqueued = videoIds.filter((_, i) => results[i]?.meta.changes === 1);
  const existing = videoIds.filter((_, i) => results[i]?.meta.changes !== 1);
  if (enqueued.length > 0) log("job.enqueued", { attrs: { count: enqueued.length, priority } });
  return json({ enqueued, existing });
}

async function getJob(env: Cloudflare.Env, videoId: string): Promise<Response> {
  await sweepExpiredLeases(env);
  const row = await env.DB.prepare(
    "SELECT video_id, kind, priority, status, leased_by, lease_expires_at, attempts, tried_nodes, last_outcome, created_at, done_at FROM jobs WHERE video_id = ? AND kind = 'primary'",
  )
    .bind(videoId)
    .first<{ tried_nodes: string }>();
  if (row === null) return errorResponse(404, "not_found", "Unknown job");
  return json({ ...row, tried_nodes: JSON.parse(row.tried_nodes) as string[] });
}

async function getTranscript(env: Cloudflare.Env, videoId: string): Promise<Response> {
  const object = await env.TRANSCRIPTS.get(`transcripts/${videoId}.json`);
  if (object === null) return errorResponse(404, "not_found", "No transcript");
  const { node_id, lease_id, produced_at } = object.customMetadata ?? {};
  return json({ video_id: videoId, transcript: await object.json(), node_id, lease_id, produced_at });
}

async function invite(env: Cloudflare.Env, body: Record<string, unknown>): Promise<Response> {
  const { email } = body;
  if (typeof email !== "string" || !email.includes("@")) return invalid("email must be a string containing @");
  const lowered = email.toLowerCase();
  await env.DB.prepare("INSERT INTO invites (email, invited_at) VALUES (?, ?) ON CONFLICT (email) DO UPDATE SET revoked = 0")
    .bind(lowered, new Date().toISOString())
    .run();
  return json({ email: lowered, revoked: false });
}

async function revokeInvite(env: Cloudflare.Env, body: Record<string, unknown>): Promise<Response> {
  const { email } = body;
  if (typeof email !== "string") return invalid("email must be a string");
  const lowered = email.toLowerCase();
  const res = await env.DB.prepare("UPDATE invites SET revoked = 1 WHERE email = ?").bind(lowered).run();
  if (res.meta.changes === 0) return errorResponse(404, "not_found", "Unknown invite");
  return json({ email: lowered, revoked: true });
}

async function listUsers(env: Cloudflare.Env): Promise<Response> {
  const { results } = await env.DB.prepare("SELECT user_sub, email, role FROM users ORDER BY email").all();
  return json({ users: results });
}

/** Section 8.8: the node is disabled, each of its active leases is revoked and its job goes through 8.7. */
async function revokeNode(env: Cloudflare.Env, nodeId: string): Promise<Response> {
  const now = new Date().toISOString();
  const [disabled, failed] = await env.DB.batch<{ video_id: string }>([
    env.DB.prepare("UPDATE nodes SET state = 'disabled', state_since = ?1, revoked_at = ?1 WHERE node_id = ?2 AND revoked_at IS NULL").bind(now, nodeId),
    env.DB.prepare(
      `UPDATE jobs SET ${FAIL_SET} WHERE kind = 'primary' AND status = 'leased'
         AND lease_id IN (SELECT lease_id FROM leases WHERE node_id = ?3 AND state = 'active') RETURNING video_id`,
    ).bind(now, "lease_revoked", nodeId),
    env.DB.prepare("UPDATE leases SET state = 'revoked' WHERE node_id = ?1 AND state = 'active'").bind(nodeId),
  ]);
  if (disabled?.meta.changes === 1) {
    log("node.revoked", { attrs: { node_id: nodeId, leases_revoked: failed?.results.length ?? 0 } });
  } else if ((await env.DB.prepare("SELECT 1 FROM nodes WHERE node_id = ?").bind(nodeId).first()) === null) {
    return errorResponse(404, "not_found", "Unknown node");
  }
  return json({ node_id: nodeId, state: "disabled" });
}

/** Handles `/ops/*`: 404 when disabled, 401 before anything else reads the request, then the route. */
export async function handleOps(request: Request, env: Cloudflare.Env, path: string): Promise<Response> {
  if (!env.OPS_TOKEN) return notFound();
  const bearer = /^Bearer (.+)$/.exec(request.headers.get("Authorization") ?? "")?.[1];
  if (bearer === undefined || !(await safeEqual(bearer, env.OPS_TOKEN))) {
    log("auth.bearer.rejected", { level: "warn", attrs: { surface: "ops", reason: bearer === undefined ? "missing" : "unknown" } });
    return errorResponse(401, "unauthorized", "Missing or wrong operator token");
  }
  if (request.method === "POST" && path === "/ops/reset") return reset(env);
  if (request.method === "POST" && path === "/ops/nodes") return withBody(request, (body) => enrollNode(env, body));
  if (request.method === "POST" && path === "/ops/jobs") return withBody(request, (body) => enqueueJobs(env, body));
  if (request.method === "POST" && path === "/ops/invites") return withBody(request, (body) => invite(env, body));
  if (request.method === "POST" && path === "/ops/invites/revoke") return withBody(request, (body) => revokeInvite(env, body));
  if (request.method === "GET" && path === "/ops/users") return listUsers(env);
  const job = request.method === "GET" ? /^\/ops\/jobs\/([^/]+)$/.exec(path)?.[1] : undefined;
  if (job !== undefined) return getJob(env, job);
  const transcript = request.method === "GET" ? /^\/ops\/transcripts\/([^/]+)$/.exec(path)?.[1] : undefined;
  if (transcript !== undefined) return getTranscript(env, transcript);
  const revoked = request.method === "DELETE" ? /^\/ops\/nodes\/([^/]+)$/.exec(path)?.[1] : undefined;
  if (revoked !== undefined) return revokeNode(env, revoked);
  return notFound();
}
