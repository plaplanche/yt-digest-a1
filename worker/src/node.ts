import type { NodeClaimResponse } from "./contracts/node-claim-response.js";
import type { NodeHeartbeatResponse } from "./contracts/node-heartbeat-response.js";
import { sha256Hex } from "./crypto.js";
import { errorResponse, json, notFound } from "./http.js";
import { log } from "./log.js";
import { FAIL_SET, sweepExpiredLeases } from "./jobs.js";
import type { NodeJobAck } from "./contracts/node-job-ack.js";
import type { NodeResultRequest } from "./contracts/node-result-request.js";
import { validateClaim, validateHeartbeat, validateRelease, validateResult } from "./validate.js";

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
  await sweepExpiredLeases(env);
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
  await sweepExpiredLeases(env);
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

interface LeaseRow {
  video_id: string;
  node_id: string;
  state: string;
  response_json: string | null;
}

const staleLease = (): Response => errorResponse(409, "stale_lease", "The lease is unknown, not yours or no longer current");

const storedResponse = (lease: LeaseRow): Response =>
  new Response(lease.response_json, { status: 200, headers: { "Content-Type": "application/json" } });

const getLease = (env: Cloudflare.Env, leaseId: string): Promise<LeaseRow | null> =>
  env.DB.prepare("SELECT video_id, node_id, state, response_json FROM leases WHERE lease_id = ?").bind(leaseId).first<LeaseRow>();

/** The answer of a request that lost a race on its lease: what the winner stored, else a stale lease. */
async function afterRace(env: Cloudflare.Env, leaseId: string, nodeId: string): Promise<Response> {
  const lease = await getLease(env, leaseId);
  return lease !== null && lease.node_id === nodeId && lease.state === "completed" ? storedResponse(lease) : staleLease();
}

/** Section 8.4 step 3: the reason the result is inconsistent, or null. */
function validationFailure(body: NodeResultRequest, videoId: string): string | null {
  const t = body.transcript;
  if (body.outcome !== "ok") return t === null ? null : "transcript_not_null";
  if (t === null) return "transcript_missing";
  if (t.status !== "ok") return "status_mismatch";
  if (t.video_id !== videoId) return "video_id_mismatch";
  if (t.pages.length === 0) return "no_pages";
  const words = t.pages.join(" ").split(/\s+/).filter((w) => w !== "" && w !== "[…]").length;
  return words === t.word_count ? null : "word_count_mismatch";
}

/** Section 8.4. */
async function result(env: Cloudflare.Env, nodeId: string, body: unknown): Promise<Response> {
  if (!validateResult(body)) return errorResponse(400, "invalid_request", "Body does not match node-result-request");
  await sweepExpiredLeases(env);
  const lease = await getLease(env, body.lease_id);
  if (lease === null || lease.node_id !== nodeId || lease.state !== "active") {
    if (lease !== null && lease.node_id === nodeId && lease.state === "completed") return storedResponse(lease);
    log("job.stale_result", { video_id: lease?.video_id, attrs: { node_id: nodeId } });
    return staleLease();
  }
  const videoId = lease.video_id;
  const now = new Date().toISOString();
  const guard = "kind = 'primary' AND status = 'leased' AND lease_id = ?3";

  const reason = validationFailure(body, videoId);
  if (reason !== null) {
    const [, failed] = await env.DB.batch<{ status: string }>([
      env.DB.prepare(
        "INSERT INTO node_events (node_id, ts, kind, video_id) SELECT ?1, ?2, 'validation_failed', ?4 WHERE EXISTS (SELECT 1 FROM leases WHERE lease_id = ?3 AND state = 'active')",
      ).bind(nodeId, now, body.lease_id, videoId),
      env.DB.prepare(`UPDATE jobs SET ${FAIL_SET} WHERE video_id = ?4 AND ${guard} RETURNING status`).bind(now, "validation_failed", body.lease_id, videoId),
      env.DB.prepare("UPDATE leases SET state = 'rejected' WHERE lease_id = ?1 AND state = 'active'").bind(body.lease_id),
    ]);
    if (failed?.results[0] === undefined) return afterRace(env, body.lease_id, nodeId);
    log("job.validation_failed", { video_id: videoId, attrs: { node_id: nodeId, reason } });
    return errorResponse(422, "validation_failed", `Result rejected: ${reason}`);
  }

  if (body.outcome === "ok") {
    try {
      await env.TRANSCRIPTS.put(`transcripts/${videoId}.json`, JSON.stringify(body.transcript), {
        httpMetadata: { contentType: "application/json" },
        customMetadata: { node_id: nodeId, lease_id: body.lease_id, produced_at: now },
        onlyIf: { etagDoesNotMatch: "*" },
      });
    } catch {
      return errorResponse(503, "storage_error", "The transcript could not be stored");
    }
  }

  const terminal = body.outcome === "ok" || body.outcome === "no_transcript";
  const set = terminal ? "status = 'done', done_at = ?1, leased_by = NULL, lease_id = NULL, lease_expires_at = NULL, last_outcome = ?2" : FAIL_SET;
  const [, updated] = await env.DB.batch<{ status: string }>([
    env.DB.prepare(
      "INSERT INTO node_events (node_id, ts, kind, video_id) SELECT ?1, ?2, ?5, ?4 WHERE EXISTS (SELECT 1 FROM leases WHERE lease_id = ?3 AND state = 'active')",
    ).bind(nodeId, now, body.lease_id, videoId, `job_${body.outcome}`),
    env.DB.prepare(`UPDATE jobs SET ${set} WHERE video_id = ?4 AND ${guard} RETURNING status`).bind(now, body.outcome, body.lease_id, videoId),
    env.DB.prepare(
      `UPDATE leases SET state = 'completed',
         response_json = json_object('video_id', video_id, 'status', (SELECT status FROM jobs WHERE jobs.video_id = leases.video_id AND kind = 'primary'))
       WHERE lease_id = ?1 AND state = 'active'`,
    ).bind(body.lease_id),
  ]);
  const status = updated?.results[0]?.status;
  if (status === undefined) return afterRace(env, body.lease_id, nodeId);
  log("job.completed", { video_id: videoId, attrs: { node_id: nodeId, outcome: body.outcome, status } });
  const ack: NodeJobAck = { video_id: videoId, status: status as NodeJobAck["status"] };
  return json(ack);
}

/** Section 8.5. */
async function release(env: Cloudflare.Env, nodeId: string, body: unknown): Promise<Response> {
  if (!validateRelease(body)) return errorResponse(400, "invalid_request", "Body does not match node-release-request");
  await sweepExpiredLeases(env);
  const lease = await getLease(env, body.lease_id);
  if (lease !== null && lease.node_id === nodeId && lease.state === "released") return storedResponse(lease);
  if (lease === null || lease.node_id !== nodeId || lease.state !== "active") return staleLease();
  const [updated] = await env.DB.batch<{ status: string }>([
    env.DB.prepare(
      `UPDATE jobs SET status = 'queued', leased_by = NULL, lease_id = NULL, lease_expires_at = NULL, attempts = attempts - 1,
         tried_nodes = (SELECT json_group_array(value) FROM json_each(jobs.tried_nodes) WHERE value != ?1), last_outcome = 'released'
       WHERE kind = 'primary' AND status = 'leased' AND lease_id = ?2 RETURNING status`,
    ).bind(nodeId, body.lease_id),
    env.DB.prepare(
      `UPDATE leases SET state = 'released', response_json = json_object('video_id', video_id, 'status', 'queued')
       WHERE lease_id = ?1 AND state = 'active'`,
    ).bind(body.lease_id),
  ]);
  if (updated?.results[0] === undefined) {
    const again = await getLease(env, body.lease_id);
    return again !== null && again.node_id === nodeId && again.state === "released" ? storedResponse(again) : staleLease();
  }
  log("job.released", { video_id: lease.video_id, attrs: { node_id: nodeId } });
  const ack: NodeJobAck = { video_id: lease.video_id, status: "queued" };
  return json(ack);
}

/** Handles `/node/*`: authentication first (section 8.1), then the body, then the endpoint. */
export async function handleNode(request: Request, env: Cloudflare.Env, path: string): Promise<Response> {
  const auth = await authenticate(request, env);
  if (auth instanceof Response) return auth;
  const endpoint = request.method === "POST" ? path : "";
  if (!["/node/heartbeat", "/node/claim", "/node/result", "/node/release"].includes(endpoint)) return notFound();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_request", "Body is not JSON");
  }
  if (endpoint === "/node/heartbeat") return heartbeat(env, auth.nodeId, auth.hourlyBudget, body);
  if (endpoint === "/node/result") return result(env, auth.nodeId, body);
  if (endpoint === "/node/release") return release(env, auth.nodeId, body);
  return claim(env, auth.nodeId, body);
}
