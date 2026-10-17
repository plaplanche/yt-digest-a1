import { log } from "./log.js";

/** Section 8.7 failure handling, as the SET clause of an UPDATE on `jobs`; binds ?1 = now and ?2 = `last_outcome`. */
export const FAIL_SET = `status = CASE WHEN attempts >= 3 THEN 'failed_video' ELSE 'queued' END,
  done_at = CASE WHEN attempts >= 3 THEN ?1 ELSE NULL END,
  leased_by = NULL, lease_id = NULL, lease_expires_at = NULL, last_outcome = ?2`;

/**
 * Section 8.6. One D1 batch (one transaction) so that concurrent sweeps never handle a job twice: the events and the
 * lease states are written for the jobs that are expired at that moment, then the jobs go through 8.7.
 */
export async function sweepExpiredLeases(env: Cloudflare.Env): Promise<void> {
  const now = new Date().toISOString();
  const expired = "kind = 'primary' AND status = 'leased' AND lease_expires_at <= ?1";
  const holders = await env.DB.prepare(`SELECT video_id, leased_by FROM jobs WHERE ${expired}`).bind(now).all<{ video_id: string; leased_by: string }>();
  if (holders.results.length === 0) return;
  const [, , failed] = await env.DB.batch<{ video_id: string; attempts: number; status: string }>([
    env.DB.prepare(
      `INSERT INTO node_events (node_id, ts, kind, video_id) SELECT leased_by, ?1, 'lease_expired', video_id FROM jobs WHERE ${expired}`,
    ).bind(now),
    env.DB.prepare(
      `UPDATE leases SET state = 'expired' WHERE state = 'active' AND lease_id IN (SELECT lease_id FROM jobs WHERE ${expired})`,
    ).bind(now),
    env.DB.prepare(`UPDATE jobs SET ${FAIL_SET} WHERE ${expired} RETURNING video_id, attempts, status`).bind(now, "lease_expired"),
  ]);
  const holderOf = new Map(holders.results.map((r) => [r.video_id, r.leased_by]));
  for (const row of failed?.results ?? []) {
    log("job.lease_expired", { video_id: row.video_id, attrs: { node_id: holderOf.get(row.video_id) ?? "", attempts: row.attempts, status: row.status } });
  }
}
