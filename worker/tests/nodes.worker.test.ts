import { env } from "cloudflare:workers";
import { Ajv2020 } from "ajv/dist/2020.js";
import { beforeEach, describe, expect, test, vi } from "vitest";
import claimResponseSchema from "../../contracts/node-claim-response.schema.json";
import errorSchema from "../../contracts/error.schema.json";
import heartbeatResponseSchema from "../../contracts/node-heartbeat-response.schema.json";
import worker from "../src/index.js";

const ajv = new Ajv2020({ strict: true });
const validateError = ajv.compile(errorSchema);
const validateClaimResponse = ajv.compile(claimResponseSchema);
const validateHeartbeatResponse = ajv.compile(heartbeatResponseSchema);

const call = (path: string, init?: RequestInit) => worker.fetch(new Request(`http://worker.test${path}`, init), env);
const ops = (path: string, body?: unknown, method = body === undefined ? "GET" : "POST") =>
  call(path, { method, headers: { Authorization: "Bearer ops-test" }, body: body === undefined ? undefined : JSON.stringify(body) });
const node = (token: string, path: string, body: unknown = {}) =>
  call(path, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

async function expectError(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get("Content-Type")).toBe("application/json");
  const body = await res.json();
  expect(validateError(body)).toBe(true);
  expect((body as { error: { code: string } }).error.code).toBe(code);
}

async function enroll(nodeId: string): Promise<string> {
  const res = await ops("/ops/nodes", { node_id: nodeId, owner_label: `owner of ${nodeId}` });
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

const vid = (n: number) => `video${String(n).padStart(6, "0")}`;
const enqueue = async (ids: string[], priority?: number) => (await ops("/ops/jobs", { video_ids: ids, priority })).json() as Promise<{ enqueued: string[]; existing: string[] }>;
const job = async (id: string) => (await ops(`/ops/jobs/${id}`)).json() as Promise<Record<string, unknown>>;
const claim = async (token: string, body: unknown = {}) => {
  const res = await node(token, "/node/claim", body);
  expect(res.status).toBe(200);
  const parsed = await res.json();
  expect(validateClaimResponse(parsed)).toBe(true);
  return (parsed as { jobs: { video_id: string; lease_id: string; lease_expires_at: string }[] }).jobs;
};

beforeEach(async () => {
  expect((await ops("/ops/reset", {})).status).toBe(200);
});

describe("POST /ops/nodes", () => {
  test("returns a token shown once, stored as its SHA-256", async () => {
    const res = await ops("/ops/nodes", { node_id: "pi-1", owner_label: "Alice" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { node_id: string; owner_label: string; token: string };
    expect(body).toMatchObject({ node_id: "pi-1", owner_label: "Alice" });
    expect(body.token).toMatch(/^ytd_node_[A-Za-z0-9_-]{43}$/);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body.token));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const row = await env.DB.prepare("SELECT token_hash, state FROM nodes WHERE node_id = 'pi-1'").first();
    expect(row).toEqual({ token_hash: hex, state: "healthy" });
  });

  test("a second enrolment of the same id is 409, revoked or not", async () => {
    await enroll("pi-1");
    await expectError(await ops("/ops/nodes", { node_id: "pi-1", owner_label: "x" }), 409, "conflict");
    await env.DB.exec("UPDATE nodes SET revoked_at = 't', state = 'disabled'");
    await expectError(await ops("/ops/nodes", { node_id: "pi-1", owner_label: "x" }), 409, "conflict");
  });

  test.each([
    [{ node_id: "Pi", owner_label: "x" }],
    [{ node_id: "-pi", owner_label: "x" }],
    [{ node_id: "a".repeat(64), owner_label: "x" }],
    [{ node_id: "pi", owner_label: "" }],
    [{ node_id: "pi", owner_label: "x".repeat(101) }],
    [{ node_id: "pi" }],
    [[]],
  ])("rejects %j", async (body) => {
    await expectError(await ops("/ops/nodes", body), 400, "invalid_request");
  });

  test("accepts the limits", async () => {
    expect((await ops("/ops/nodes", { node_id: "a".repeat(63), owner_label: "x".repeat(100) })).status).toBe(200);
  });
});

describe("POST /ops/jobs and GET /ops/jobs/<id>", () => {
  test("enqueues new ids and reports existing ones in request order", async () => {
    expect(await enqueue([vid(1), vid(2)], 5)).toEqual({ enqueued: [vid(1), vid(2)], existing: [] });
    expect(await enqueue([vid(3), vid(1), vid(4)])).toEqual({ enqueued: [vid(3), vid(4)], existing: [vid(1)] });
    expect(await job(vid(1))).toMatchObject({
      video_id: vid(1), kind: "primary", priority: 5, status: "queued", leased_by: null, lease_expires_at: null,
      attempts: 0, tried_nodes: [], last_outcome: null, done_at: null,
    });
    expect(await job(vid(3))).toMatchObject({ priority: 0 });
  });

  test("an existing job keeps its state and its priority only goes up", async () => {
    await enqueue([vid(1)], 5);
    await enqueue([vid(1)], 2);
    expect(await job(vid(1))).toMatchObject({ priority: 5 });
    await enqueue([vid(1)], 9);
    expect(await job(vid(1))).toMatchObject({ priority: 9, status: "queued" });
    const token = await enroll("n1");
    await claim(token);
    expect(await enqueue([vid(1)], 10)).toEqual({ enqueued: [], existing: [vid(1)] });
    expect(await job(vid(1))).toMatchObject({ priority: 10, status: "leased", attempts: 1 });
  });

  test.each([
    [{ video_ids: [] }],
    [{ video_ids: ["short"] }],
    [{ video_ids: Array.from({ length: 101 }, (_, i) => vid(i)) }],
    [{ video_ids: [vid(1)], priority: -1 }],
    [{ video_ids: [vid(1)], priority: 1.5 }],
    [{ priority: 1 }],
  ])("rejects %j", async (body) => {
    await expectError(await ops("/ops/jobs", body), 400, "invalid_request");
  });

  test("accepts 100 ids and answers 404 for an unknown job", async () => {
    const ids = Array.from({ length: 100 }, (_, i) => vid(i));
    expect((await enqueue(ids)).enqueued).toHaveLength(100);
    await expectError(await ops(`/ops/jobs/${vid(999)}`), 404, "not_found");
  });
});

describe("/node authentication", () => {
  test.each(["/node/heartbeat", "/node/claim"])("%s: 401 without bearer, with an unknown token and with the operator token", async (path) => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expectError(await call(path, { method: "POST", body: "{}" }), 401, "unauthorized");
    await expectError(await node("ytd_node_unknown", path), 401, "unauthorized");
    await expectError(await node("ops-test", path), 401, "unauthorized");
    const reasons = spy.mock.calls
      .map(([line]) => JSON.parse(String(line)) as { event: string; attrs: Record<string, string> })
      .filter((l) => l.event === "auth.bearer.rejected")
      .map((l) => `${l.attrs.surface}:${l.attrs.reason}`);
    expect(reasons).toEqual(["node:missing", "node:unknown", "node:unknown"]);
    spy.mockRestore();
  });

  test("authentication comes before the body", async () => {
    await expectError(await call("/node/claim", { method: "POST", body: "{not json" }), 401, "unauthorized");
  });

  test("a revoked node's token is refused", async () => {
    const token = await enroll("n1");
    await env.DB.exec("UPDATE nodes SET revoked_at = 't', state = 'disabled'");
    await expectError(await node(token, "/node/claim"), 401, "unauthorized");
  });

  test("an authenticated bad body is 400, an unknown route 404", async () => {
    const token = await enroll("n1");
    await expectError(await call("/node/claim", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: "{x" }), 400, "invalid_request");
    await expectError(await node(token, "/node/claim", { max_jobs: 0 }), 400, "invalid_request");
    await expectError(await node(token, "/node/claim", { max_jobs: 11 }), 400, "invalid_request");
    await expectError(await node(token, "/node/claim", { other: 1 }), 400, "invalid_request");
    await expectError(await node(token, "/node/heartbeat", { version: "1" }), 400, "invalid_request");
    await expectError(await node(token, "/node/nope"), 404, "not_found");
  });
});

describe("POST /node/heartbeat", () => {
  test("updates the node and answers healthy, run, 60", async () => {
    const token = await enroll("n1");
    const res = await node(token, "/node/heartbeat", { version: "0.2.0", uptime_s: 5, jobs_in_progress: 0 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(validateHeartbeatResponse(body)).toBe(true);
    expect(body).toEqual({ node_id: "n1", state: "healthy", hourly_budget: 60, directive: "run" });
    const row = await env.DB.prepare("SELECT last_heartbeat_at, version FROM nodes").first<{ last_heartbeat_at: string; version: string }>();
    expect(row?.version).toBe("0.2.0");
    expect(row?.last_heartbeat_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  });
});

describe("POST /node/claim", () => {
  test("an empty queue gives no job", async () => {
    const token = await enroll("n1");
    const res = await node(token, "/node/claim");
    expect(await res.json()).toEqual({ jobs: [] });
  });

  test("takes 3 by default, or max_jobs, in priority then creation then id order", async () => {
    const token = await enroll("n1");
    await enqueue([vid(5)], 0);
    await new Promise((r) => setTimeout(r, 5));
    await enqueue([vid(4), vid(2)], 0);
    await enqueue([vid(9)], 7);
    await enqueue([vid(1)], 1);
    // Same priority and created_at: video id breaks the tie.
    const first = await claim(token);
    expect(first.map((j) => j.video_id)).toEqual([vid(9), vid(1), vid(5)]);
    const second = await claim(token, { max_jobs: 10 });
    expect(second.map((j) => j.video_id)).toEqual([vid(2), vid(4)]);
    expect(await claim(token)).toEqual([]);
  });

  test("a claimed job is leased with its attempt, its node and a leases row", async () => {
    const token = await enroll("n1");
    await enqueue([vid(1)]);
    const before = Date.now();
    const [claimed] = await claim(token, { max_jobs: 1 });
    expect(claimed?.lease_id.length).toBeGreaterThanOrEqual(16);
    expect(Date.parse(claimed!.lease_expires_at) - before).toBeGreaterThanOrEqual(599_000);
    expect(await job(vid(1))).toMatchObject({
      status: "leased", leased_by: "n1", attempts: 1, tried_nodes: ["n1"], lease_expires_at: claimed!.lease_expires_at,
    });
    const lease = await env.DB.prepare("SELECT * FROM leases").first();
    expect(lease).toMatchObject({ lease_id: claimed!.lease_id, video_id: vid(1), node_id: "n1", expires_at: claimed!.lease_expires_at, state: "active", response_json: null });
    const stored = await env.DB.prepare("SELECT lease_id FROM jobs").first<{ lease_id: string }>();
    expect(stored?.lease_id).toBe(claimed!.lease_id);
  });

  test("a leased job is not handed out twice, and a node already tried is skipped", async () => {
    const t1 = await enroll("n1");
    const t2 = await enroll("n2");
    await enqueue([vid(1)]);
    expect(await claim(t1)).toHaveLength(1);
    expect(await claim(t2)).toEqual([]);
    // Back to queued with n1 in tried_nodes (as a failure would leave it).
    await env.DB.exec("UPDATE jobs SET status = 'queued', leased_by = NULL, lease_id = NULL, lease_expires_at = NULL");
    expect(await claim(t1)).toEqual([]);
    expect((await claim(t2)).map((j) => j.video_id)).toEqual([vid(1)]);
    expect(await job(vid(1))).toMatchObject({ attempts: 2, tried_nodes: ["n1", "n2"] });
  });

  test("done and failed_video jobs are never handed out", async () => {
    const token = await enroll("n1");
    await enqueue([vid(1), vid(2)]);
    await env.DB.exec("UPDATE jobs SET status = 'done' WHERE video_id = '" + vid(1) + "'");
    await env.DB.exec("UPDATE jobs SET status = 'failed_video' WHERE video_id = '" + vid(2) + "'");
    expect(await claim(token)).toEqual([]);
  });
});

describe("concurrent claims on the real D1 (8.3, 8.9)", () => {
  test("no job is handed out twice and each claim gets min(max_jobs, eligible jobs)", async () => {
    const tokens = await Promise.all(["n1", "n2", "n3", "n4"].map(enroll));
    const ids = Array.from({ length: 40 }, (_, i) => vid(i));
    await enqueue(ids);
    // 4 nodes x 3 claims of 3 jobs: 36 jobs requested of 40 eligible, so every claim must be full.
    const claims = await Promise.all(tokens.flatMap((t) => [1, 2, 3].map(() => claim(t, { max_jobs: 3 }))));
    for (const jobs of claims) expect(jobs).toHaveLength(3);
    const handed = claims.flat().map((j) => j.video_id);
    expect(new Set(handed).size).toBe(handed.length);
    expect(new Set(claims.flat().map((j) => j.lease_id)).size).toBe(handed.length);
    const leases = await env.DB.prepare("SELECT COUNT(*) AS n FROM leases WHERE state = 'active'").first<{ n: number }>();
    expect(leases?.n).toBe(36);

    // Now more demand than supply: 4 remaining jobs, 4 nodes asking for 3.
    const rest = await Promise.all(tokens.map((t) => claim(t, { max_jobs: 3 })));
    const sizes = rest.map((r) => r.length).sort();
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(4);
    expect(new Set([...handed, ...rest.flat().map((j) => j.video_id)]).size).toBe(40);
  });
});
