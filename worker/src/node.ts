import type { NodeClaimResponse } from "./contracts/node-claim-response.js";
import type { NodeHeartbeatResponse } from "./contracts/node-heartbeat-response.js";
import { sha256Hex } from "./crypto.js";
import { errorResponse, json, notFound } from "./http.js";
import { log } from "./log.js";
import { validateClaim, validateHeartbeat } from "./validate.js";

const DEFAULT_LEASE_SECONDS = 600;
const DEFAULT_MAX_JOBS = 3;

/** The authenticated node, or the 401 to answer (section 8.1). */
async function authenticate(request: Request, env: Cloudflare.Env): Promise<{ nodeId: string; hourlyBudget: number } | Response> {
  const bearer = /^Bearer (.+)$/.exec(request.headers.get("Authorization") ?? "")?.[1];
  const row =
    bearer === undefined
      ? null
      : await env.DB.prepare("SELECT node_id, hourly_budget, revoked_at FROM nodes WHERE token_hash = ?")
          .bind(await sha256Hex(bearer))
          .first<{ node_id: string; hourly_budget: number; revoked_at: string | null }>();
  if (bearer === undefined || row === null || row.revoked_at !== null) {
    const reason = bearer === undefined ? "missing" : row === null ? "unknown" : "revoked";
    log("auth.bearer.rejected", { level: "warn", attrs: { surface: "node", reason } });
    return errorResponse(401, "unauthorized", "Missing, unknown or revoked node token");
  }
  return { nodeId: row.node_id, hourlyBudget: row.hourly_budget };
}

async function heartbeat(env: Cloudflare.Env, nodeId: string, hourlyBudget: number, body: unknown): Promise<Response> {
  if (!validateHeartbeat(body)) return errorResponse(400, "invalid_request", "Body does not match node-heartbeat-request");
  await env.DB.prepare("UPDATE nodes SET last_heartbeat_at = ?, version = ? WHERE node_id = ?")
    .bind(new Date().toISOString(), body.version, nodeId)
    .run();
  log("node.heartbeat", { attrs: { node_id: nodeId, version: body.version, jobs_in_progress: body.jobs_in_progress } });
  const response: NodeHeartbeatResponse = { node_id: nodeId, state: "healthy", hourly_budget: hourlyBudget, directive: "run" };
  return json(response);
}

function leaseSeconds(env: Cloudflare.Env): number {
  const n = Number(env.LEASE_SECONDS);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_LEASE_SECONDS;
}

/** Code-unit order, the same as SQLite's BINARY collation that picks the jobs (`localeCompare` would differ). */
const codeUnitOrder = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

interface ClaimedRow {
  video_id: string;
  lease_id: string;
  lease_expires_at: string;
  attempts: number;
  priority: number;
  created_at: string;
}

/**
 * Section 8.3. The jobs are chosen and marked in one UPDATE statement, so two claims never take the same job and
 * none comes back short; the `leases` rows are written in the same D1 batch (one transaction).
 */
async function claim(env: Cloudflare.Env, nodeId: string, body: unknown): Promise<Response> {
  if (!validateClaim(body)) return errorResponse(400, "invalid_request", "Body does not match node-claim-request");
  const maxJobs = body.max_jobs ?? DEFAULT_MAX_JOBS;
  const seconds = leaseSeconds(env);
  const now = new Date();
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + seconds * 1000).toISOString();

  const [claimed] = await env.DB.batch<ClaimedRow>([
    env.DB.prepare(
      `UPDATE jobs SET status = 'leased', leased_by = ?1, lease_id = lower(hex(randomblob(16))), lease_expires_at = ?2,
         attempts = attempts + 1, tried_nodes = json_insert(tried_nodes, '$[#]', ?1)
       WHERE kind = 'primary' AND video_id IN (
         SELECT video_id FROM jobs
         WHERE kind = 'primary' AND status = 'queued'
           AND NOT EXISTS (SELECT 1 FROM json_each(jobs.tried_nodes) WHERE value = ?1)
         ORDER BY priority DESC, created_at ASC, video_id ASC LIMIT ?3)
       RETURNING video_id, lease_id, lease_expires_at, attempts, priority, created_at`,
    ).bind(nodeId, expiresAt, maxJobs),
    env.DB.prepare(
      `INSERT INTO leases (lease_id, video_id, node_id, issued_at, expires_at, state)
       SELECT lease_id, video_id, leased_by, ?2, lease_expires_at, 'active' FROM jobs
       WHERE kind = 'primary' AND status = 'leased' AND leased_by = ?1
         AND lease_id NOT IN (SELECT lease_id FROM leases)`,
    ).bind(nodeId, issuedAt),
  ]);

  const rows = (claimed?.results ?? []).sort(
    (a, b) => b.priority - a.priority || codeUnitOrder(a.created_at, b.created_at) || codeUnitOrder(a.video_id, b.video_id),
  );
  for (const row of rows) {
    log("job.claimed", { video_id: row.video_id, attrs: { node_id: nodeId, attempt: row.attempts, lease_seconds: seconds } });
  }
  const response: NodeClaimResponse = {
    jobs: rows.map((r) => ({ video_id: r.video_id, lease_id: r.lease_id, lease_expires_at: r.lease_expires_at })),
  };
  return json(response);
}

/** Handles `/node/*`: authentication first (section 8.1), then the body, then the endpoint. */
export async function handleNode(request: Request, env: Cloudflare.Env, path: string): Promise<Response> {
  const auth = await authenticate(request, env);
  if (auth instanceof Response) return auth;
  const endpoint = request.method === "POST" ? path : "";
  if (endpoint !== "/node/heartbeat" && endpoint !== "/node/claim") return notFound();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_request", "Body is not JSON");
  }
  return endpoint === "/node/heartbeat" ? heartbeat(env, auth.nodeId, auth.hourlyBudget, body) : claim(env, auth.nodeId, body);
}
