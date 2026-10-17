import { env } from "cloudflare:workers";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import ackSchema from "../../contracts/node-job-ack.schema.json";
import errorSchema from "../../contracts/error.schema.json";
import worker from "../src/index.js";

const ajv = new Ajv2020({ strict: true });
const validateError = ajv.compile(errorSchema);
const validateAck = ajv.compile(ackSchema);

const call = (path: string, init?: RequestInit, e: Cloudflare.Env = env) => worker.fetch(new Request(`http://worker.test${path}`, init), e);
const ops = (path: string, body?: unknown, method = body === undefined ? "GET" : "POST") =>
  call(path, { method, headers: { Authorization: "Bearer ops-test" }, body: body === undefined ? undefined : JSON.stringify(body) });
const node = (token: string, path: string, body: unknown = {}, e: Cloudflare.Env = env) =>
  call(path, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }, e);

async function expectError(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  const body = await res.json();
  expect(validateError(body)).toBe(true);
  expect((body as { error: { code: string } }).error.code).toBe(code);
}

const enroll = async (id: string) => ((await (await ops("/ops/nodes", { node_id: id, owner_label: id })).json()) as { token: string }).token;
const vid = (n: number) => `video${String(n).padStart(6, "0")}`;
const job = async (id: string) => (await ops(`/ops/jobs/${id}`)).json() as Promise<Record<string, unknown>>;
const claim = async (token: string, max = 3) =>
  ((await (await node(token, "/node/claim", { max_jobs: max })).json()) as { jobs: { video_id: string; lease_id: string; lease_expires_at: string }[] }).jobs;
const claimOne = async (token: string) => {
  const [j] = await claim(token, 1);
  return j!;
};
const transcript = (id: string, text = "hello big world") => ({
  video_id: id, status: "ok", lang: "en", source: "manual", word_count: text.split(/\s+/).length, truncated: false, sponsor_ratio: null, pages: [text],
});
const result = (token: string, lease_id: string, outcome: string, t: unknown = null) => node(token, "/node/result", { lease_id, outcome, transcript: t });
const events = async () => (await env.DB.prepare("SELECT node_id, kind, video_id FROM node_events ORDER BY rowid").all()).results;
const leaseState = async (id: string) => (await env.DB.prepare("SELECT state FROM leases WHERE lease_id = ?").bind(id).first<{ state: string }>())?.state;
const objects = async () => (await env.TRANSCRIPTS.list({ prefix: "transcripts/" })).objects.length;

beforeEach(async () => {
  expect((await ops("/ops/reset", {})).status).toBe(200);
});
afterEach(() => vi.useRealTimers());

describe("POST /node/result, outcome ok", () => {
  test("stores the transcript in R2 with its metadata, makes the job done, and a retry changes nothing", async () => {
    const token = await enroll("n1");
    await ops("/ops/jobs", { video_ids: [vid(1)] });
    const lease = await claimOne(token);
    const t = transcript(vid(1));
    const res = await result(token, lease.lease_id, "ok", t);
    expect(res.status).toBe(200);
    const ack = await res.json();
    expect(validateAck(ack)).toBe(true);
    expect(ack).toEqual({ video_id: vid(1), status: "done" });
    expect(await job(vid(1))).toMatchObject({ status: "done", last_outcome: "ok", leased_by: null, attempts: 1 });
    expect((await job(vid(1))).done_at).toMatch(/Z$/);

    const object = await env.TRANSCRIPTS.get(`transcripts/${vid(1)}.json`);
    expect(await object?.json()).toEqual(t);
    expect(object?.httpMetadata?.contentType).toBe("application/json");
    expect(object?.customMetadata).toMatchObject({ node_id: "n1", lease_id: lease.lease_id });
    expect(object?.customMetadata?.produced_at).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
    const stored = await (await ops(`/ops/transcripts/${vid(1)}`)).json();
    expect(stored).toEqual({ video_id: vid(1), transcript: t, node_id: "n1", lease_id: lease.lease_id, produced_at: object?.customMetadata?.produced_at });
    expect(await leaseState(lease.lease_id)).toBe("completed");
    expect(await events()).toEqual([{ node_id: "n1", kind: "job_ok", video_id: vid(1) }]);

    const etag = object?.etag;
    const again = await result(token, lease.lease_id, "ok", transcript(vid(1), "other words"));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(ack);
    expect((await env.TRANSCRIPTS.get(`transcripts/${vid(1)}.json`))?.etag).toBe(etag);
    expect(await events()).toHaveLength(1);
  });

  test("an existing object is never overwritten", async () => {
    const token = await enroll("n1");
    await ops("/ops/jobs", { video_ids: [vid(1)] });
    await env.TRANSCRIPTS.put(`transcripts/${vid(1)}.json`, JSON.stringify(transcript(vid(1), "first one")));
    const lease = await claimOne(token);
    expect((await result(token, lease.lease_id, "ok", transcript(vid(1)))).status).toBe(200);
    expect(await job(vid(1))).toMatchObject({ status: "done" });
    expect(await (await env.TRANSCRIPTS.get(`transcripts/${vid(1)}.json`))?.json()).toEqual(transcript(vid(1), "first one"));
  });

  test("an R2 failure is 503 storage_error and leaves the lease active", async () => {
    const token = await enroll("n1");
    await ops("/ops/jobs", { video_ids: [vid(1)] });
    const lease = await claimOne(token);
    const broken = { ...env, TRANSCRIPTS: { put: () => Promise.reject(new Error("boom")) } } as unknown as Cloudflare.Env;
    await expectError(await node(token, "/node/result", { lease_id: lease.lease_id, outcome: "ok", transcript: transcript(vid(1)) }, broken), 503, "storage_error");
    expect(await leaseState(lease.lease_id)).toBe("active");
    expect(await job(vid(1))).toMatchObject({ status: "leased", attempts: 1 });
    expect((await result(token, lease.lease_id, "ok", transcript(vid(1)))).status).toBe(200);
  });

  test("GET /ops/transcripts of an unknown video is 404", async () => {
    await expectError(await ops(`/ops/transcripts/${vid(1)}`), 404, "not_found");
  });
});

describe("POST /node/result, other outcomes", () => {
  test("no_transcript is terminal and writes nothing to R2", async () => {
    const token = await enroll("n1");
    await ops("/ops/jobs", { video_ids: [vid(1)] });
    const lease = await claimOne(token);
    const res = await result(token, lease.lease_id, "no_transcript");
    expect(await res.json()).toEqual({ video_id: vid(1), status: "done" });
    expect(await job(vid(1))).toMatchObject({ status: "done", last_outcome: "no_transcript" });
    expect(await objects()).toBe(0);
    expect(await events()).toEqual([{ node_id: "n1", kind: "job_no_transcript", video_id: vid(1) }]);
  });

  test.each(["unavailable", "blocked", "error"])("%s requeues for another node, and the third failure is failed_video", async (outcome) => {
    const tokens = await Promise.all(["n1", "n2", "n3", "n4"].map(enroll));
    await ops("/ops/jobs", { video_ids: [vid(1)] });
    for (const [i, token] of tokens.slice(0, 3).entries()) {
      const lease = await claimOne(token);
      expect(lease.video_id).toBe(vid(1));
      const res = await result(token, lease.lease_id, outcome);
      expect(res.status).toBe(200);
      const status = i < 2 ? "queued" : "failed_video";
      expect(await res.json()).toEqual({ video_id: vid(1), status });
      expect(await job(vid(1))).toMatchObject({ status, last_outcome: outcome, leased_by: null, lease_expires_at: null, attempts: i + 1 });
      if (i === 0) expect(await claim(token)).toEqual([]);
    }
    expect((await job(vid(1))).done_at).not.toBeNull();
    expect(await job(vid(1))).toMatchObject({ tried_nodes: ["n1", "n2", "n3"] });
    expect(await claim(tokens[3]!)).toEqual([]);
    expect((await events()).map((e) => e.kind)).toEqual([`job_${outcome}`, `job_${outcome}`, `job_${outcome}`]);
    expect(await objects()).toBe(0);
  });
});

describe("POST /node/result, checks and validation", () => {
  test("a bad body is 400 and changes nothing", async () => {
    const token = await enroll("n1");
    await ops("/ops/jobs", { video_ids: [vid(1)] });
    const lease = await claimOne(token);
    await expectError(await node(token, "/node/result", { lease_id: lease.lease_id, outcome: "ok" }), 400, "invalid_request");
    await expectError(await node(token, "/node/result", { lease_id: lease.lease_id, outcome: "nope", transcript: null }), 400, "invalid_request");
    await expectError(await node(token, "/node/release", {}), 400, "invalid_request");
    expect(await leaseState(lease.lease_id)).toBe("active");
  });

  test("an unknown lease and another node's lease are 409 stale_lease, with nothing written", async () => {
    const [t1, t2] = await Promise.all([enroll("n1"), enroll("n2")]);
    await ops("/ops/jobs", { video_ids: [vid(1)] });
    const lease = await claimOne(t1);
    await expectError(await result(t1, "0".repeat(32), "ok", transcript(vid(1))), 409, "stale_lease");
    await expectError(await result(t2, lease.lease_id, "ok", transcript(vid(1))), 409, "stale_lease");
    expect(await objects()).toBe(0);
    expect(await events()).toEqual([]);
    expect(await job(vid(1))).toMatchObject({ status: "leased", leased_by: "n1" });
  });

  test("a completed lease of another node is 409, not the stored answer", async () => {
    const [t1, t2] = await Promise.all([enroll("n1"), enroll("n2")]);
    await ops("/ops/jobs", { video_ids: [vid(1)] });
    const lease = await claimOne(t1);
    await result(t1, lease.lease_id, "no_transcript");
    await expectError(await result(t2, lease.lease_id, "no_transcript"), 409, "stale_lease");
  });

  const t = (over: Record<string, unknown>) => ({ ...transcript(vid(1)), ...over });
  test.each([
    ["ok with a null transcript", "ok", () => null],
    ["ok with a transcript status other than ok", "ok", () => t({ status: "blocked" })],
    ["ok with another video id", "ok", () => t({ video_id: vid(2) })],
    ["ok with no pages", "ok", () => t({ pages: [], word_count: 0 })],
    ["ok with a wrong word count", "ok", () => t({ word_count: 2 })],
    ["unavailable with a transcript", "unavailable", () => t({ status: "unavailable" })],
    ["no_transcript with a transcript", "no_transcript", () => t({ status: "no_transcript" })],
  ])("%s is 422 and counts as a failure", async (_name, outcome, make) => {
    const [t1, t2] = await Promise.all([enroll("n1"), enroll("n2")]);
    await ops("/ops/jobs", { video_ids: [vid(1)] });
    const lease = await claimOne(t1);
    await expectError(await result(t1, lease.lease_id, outcome, make()), 422, "validation_failed");
    expect(await leaseState(lease.lease_id)).toBe("rejected");
    expect(await job(vid(1))).toMatchObject({ status: "queued", last_outcome: "validation_failed", leased_by: null, attempts: 1 });
    expect(await events()).toEqual([{ node_id: "n1", kind: "validation_failed", video_id: vid(1) }]);
    expect(await objects()).toBe(0);
    // the lease is rejected: a retry is stale, and the job goes to another node
    await expectError(await result(t1, lease.lease_id, "ok", transcript(vid(1))), 409, "stale_lease");
    expect(await claim(t1)).toEqual([]);
    expect(await claim(t2)).toHaveLength(1);
  });

  test("the third validation failure gives failed_video", async () => {
    const tokens = await Promise.all(["n1", "n2", "n3"].map(enroll));
    await ops("/ops/jobs", { video_ids: [vid(1)] });
    for (const token of tokens) await result(token, (await claimOne(token)).lease_id, "ok", null);
    expect(await job(vid(1))).toMatchObject({ status: "failed_video", last_outcome: "validation_failed" });
  });

  test("the word count ignores the […] marker and counts whitespace-separated tokens across pages", async () => {
    const token = await enroll("n1");
    await ops("/ops/jobs", { video_ids: [vid(1)] });
    const lease = await claimOne(token);
    const ok = t({ pages: ["one  two\n\n[…]\n\nthree", "four\tfive"], word_count: 5, truncated: true });
    expect((await result(token, lease.lease_id, "ok", ok)).status).toBe(200);
  });
});

describe("lease expiry (8.6)", () => {
  test("an expired lease requeues the job for another node, and the late result is 409 and writes nothing", async () => {
    const [t1, t2] = await Promise.all([enroll("n1"), enroll("n2")]);
    await ops("/ops/jobs", { video_ids: [vid(1)] });
    const lease = await claimOne(t1);
    await env.DB.exec("UPDATE jobs SET lease_expires_at = '2000-01-01T00:00:00.000Z'");
    expect(await job(vid(1))).toMatchObject({ status: "queued", last_outcome: "lease_expired", leased_by: null, tried_nodes: ["n1"], attempts: 1 });
    expect(await leaseState(lease.lease_id)).toBe("expired");
    expect(await events()).toEqual([{ node_id: "n1", kind: "lease_expired", video_id: vid(1) }]);
    expect(await claim(t1)).toEqual([]);
    const second = await claimOne(t2);
    await expectError(await result(t1, lease.lease_id, "ok", transcript(vid(1))), 409, "stale_lease");
    await expectError(await node(t1, "/node/release", { lease_id: lease.lease_id }), 409, "stale_lease");
    expect(await objects()).toBe(0);
    expect(await job(vid(1))).toMatchObject({ status: "leased", leased_by: "n2", attempts: 2 });
    expect((await result(t2, second.lease_id, "no_transcript")).status).toBe(200);
  });

  test("a lease expires exactly at lease_expires_at, not before", async () => {
    const token = await enroll("n1");
    await ops("/ops/jobs", { video_ids: [vid(1)] });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
    const lease = await claimOne(token);
    expect(lease.lease_expires_at).toBe("2030-01-01T00:10:00.000Z");
    vi.setSystemTime(new Date("2030-01-01T00:09:59.999Z"));
    expect(await job(vid(1))).toMatchObject({ status: "leased" });
    vi.setSystemTime(new Date("2030-01-01T00:10:00.000Z"));
    expect(await job(vid(1))).toMatchObject({ status: "queued", last_outcome: "lease_expired" });
  });

  test("the third expiry gives failed_video, and an expiry on the result path is swept first", async () => {
    const tokens = await Promise.all(["n1", "n2", "n3"].map(enroll));
    await ops("/ops/jobs", { video_ids: [vid(1)] });
    for (const token of tokens) {
      await claimOne(token);
      await env.DB.exec("UPDATE jobs SET lease_expires_at = '2000-01-01T00:00:00.000Z' WHERE status = 'leased'");
      await node(token, "/node/heartbeat", { version: "1", uptime_s: 0, jobs_in_progress: 0 });
    }
    expect(await job(vid(1))).toMatchObject({ status: "failed_video", attempts: 3, last_outcome: "lease_expired" });
    expect((await job(vid(1))).done_at).not.toBeNull();
  });

  test("a fresh lease is not swept", async () => {
    const token = await enroll("n1");
    await ops("/ops/jobs", { video_ids: [vid(1)] });
    await claimOne(token);
    await claim(token);
    expect(await job(vid(1))).toMatchObject({ status: "leased" });
  });
});

describe("POST /node/release", () => {
  test("undoes the claim and is idempotent", async () => {
    const [t1, t2] = await Promise.all([enroll("n1"), enroll("n2")]);
    await ops("/ops/jobs", { video_ids: [vid(1)] });
    const lease = await claimOne(t1);
    const res = await node(t1, "/node/release", { lease_id: lease.lease_id });
    expect(res.status).toBe(200);
    const ack = await res.json();
    expect(validateAck(ack)).toBe(true);
    expect(ack).toEqual({ video_id: vid(1), status: "queued" });
    expect(await job(vid(1))).toMatchObject({ status: "queued", leased_by: null, lease_expires_at: null, attempts: 0, tried_nodes: [], last_outcome: "released" });
    expect(await env.DB.prepare("SELECT lease_id FROM jobs").first()).toEqual({ lease_id: null });
    expect(await leaseState(lease.lease_id)).toBe("released");
    const again = await node(t1, "/node/release", { lease_id: lease.lease_id });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(ack);
    // the releasing node may take the job again; the released lease cannot report
    await expectError(await result(t1, lease.lease_id, "no_transcript"), 409, "stale_lease");
    const retaken = await claim(t1);
    expect(retaken).toHaveLength(1);
    expect(await job(vid(1))).toMatchObject({ attempts: 1, tried_nodes: ["n1"] });
    // the old release retry no longer touches the job
    expect((await node(t1, "/node/release", { lease_id: lease.lease_id })).status).toBe(200);
    expect(await job(vid(1))).toMatchObject({ status: "leased", attempts: 1 });
    await expectError(await node(t2, "/node/release", { lease_id: retaken[0]!.lease_id }), 409, "stale_lease");
  });

  test("an unknown or completed lease is 409", async () => {
    const token = await enroll("n1");
    await ops("/ops/jobs", { video_ids: [vid(1)] });
    const lease = await claimOne(token);
    await expectError(await node(token, "/node/release", { lease_id: "nope" }), 409, "stale_lease");
    await result(token, lease.lease_id, "no_transcript");
    await expectError(await node(token, "/node/release", { lease_id: lease.lease_id }), 409, "stale_lease");
    expect(await job(vid(1))).toMatchObject({ status: "done" });
  });
});

describe("DELETE /ops/nodes/<id>", () => {
  test("disables the node, revokes its leases and reassigns its jobs; again gives the same 200", async () => {
    const [t1, t2] = await Promise.all([enroll("n1"), enroll("n2")]);
    await ops("/ops/jobs", { video_ids: [vid(1), vid(2)] });
    const leases = await claim(t1, 2);
    const res = await ops("/ops/nodes/n1", undefined, "DELETE");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ node_id: "n1", state: "disabled" });
    const row = await env.DB.prepare("SELECT state, revoked_at FROM nodes WHERE node_id = 'n1'").first<{ state: string; revoked_at: string }>();
    expect(row?.state).toBe("disabled");
    expect(row?.revoked_at).toMatch(/Z$/);
    for (const l of leases) expect(await leaseState(l.lease_id)).toBe("revoked");
    expect(await job(vid(1))).toMatchObject({ status: "queued", last_outcome: "lease_revoked", leased_by: null, attempts: 1, tried_nodes: ["n1"] });

    await expectError(await node(t1, "/node/claim"), 401, "unauthorized");
    await expectError(await result(t1, leases[0]!.lease_id, "no_transcript"), 401, "unauthorized");
    expect((await claim(t2)).map((j) => j.video_id)).toEqual([vid(1), vid(2)]);

    const again = await ops("/ops/nodes/n1", undefined, "DELETE");
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ node_id: "n1", state: "disabled" });
    expect(await job(vid(1))).toMatchObject({ status: "leased", leased_by: "n2" });
    await expectError(await ops("/ops/nodes/ghost", undefined, "DELETE"), 404, "not_found");
  });

  test("a job on its third attempt becomes failed_video", async () => {
    const tokens = await Promise.all(["n1", "n2", "n3"].map(enroll));
    await ops("/ops/jobs", { video_ids: [vid(1)] });
    for (const token of tokens.slice(0, 2)) await result(token, (await claimOne(token)).lease_id, "error");
    await claimOne(tokens[2]!);
    await ops("/ops/nodes/n3", undefined, "DELETE");
    expect(await job(vid(1))).toMatchObject({ status: "failed_video", last_outcome: "lease_revoked" });
  });

  test("needs the operator token", async () => {
    await enroll("n1");
    await expectError(await call("/ops/nodes/n1", { method: "DELETE" }), 401, "unauthorized");
  });
});

describe("log events", () => {
  test("completed, released, lease_expired, stale_result, validation_failed and revoked are logged without secrets", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const [t1, t2] = await Promise.all([enroll("n1"), enroll("n2")]);
      await ops("/ops/jobs", { video_ids: [vid(1), vid(2), vid(3), vid(4)] });
      const [a, b, c, d] = await claim(t1, 4);
      await result(t1, a!.lease_id, "no_transcript");
      await node(t1, "/node/release", { lease_id: b!.lease_id });
      await result(t1, c!.lease_id, "ok", null);
      await env.DB.exec(`UPDATE jobs SET lease_expires_at = '2000-01-01T00:00:00.000Z' WHERE lease_id = '${d!.lease_id}'`);
      await result(t1, d!.lease_id, "no_transcript");
      await claimOne(t2);
      await ops("/ops/nodes/n2", undefined, "DELETE");
      const lines = spy.mock.calls.map((c) => JSON.parse(String(c[0])) as { event: string; video_id?: string; attrs: Record<string, unknown> });
      const find = (event: string) => lines.filter((l) => l.event === event);
      expect(find("job.completed")).toEqual([expect.objectContaining({ video_id: vid(1), attrs: { node_id: "n1", outcome: "no_transcript", status: "done" } })]);
      expect(find("job.released")).toEqual([expect.objectContaining({ video_id: vid(2), attrs: { node_id: "n1" } })]);
      expect(find("job.validation_failed")).toEqual([expect.objectContaining({ video_id: vid(3), attrs: { node_id: "n1", reason: "transcript_missing" } })]);
      expect(find("job.lease_expired")).toEqual([expect.objectContaining({ video_id: vid(4), attrs: { node_id: "n1", attempts: 1, status: "queued" } })]);
      expect(find("job.stale_result")).toEqual([expect.objectContaining({ video_id: vid(4), attrs: { node_id: "n1" } })]);
      expect(find("node.revoked")).toEqual([expect.objectContaining({ attrs: { node_id: "n2", leases_revoked: 1 } })]);
      expect(spy.mock.calls.map((c) => String(c[0])).join("\n")).not.toContain(t1);
    } finally {
      spy.mockRestore();
    }
  });
});
