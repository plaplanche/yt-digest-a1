import { expect, test, type APIRequestContext } from "@playwright/test";

const OPS = { Authorization: `Bearer ${process.env.OPS_TOKEN ?? "ops-local"}` };
const LEASE_MS = 2000;
const videoId = (n: number) => `e2elease${String(n).padStart(3, "0")}`;

interface Lease {
  video_id: string;
  lease_id: string;
}

async function enroll(request: APIRequestContext, nodeId: string): Promise<string> {
  const res = await request.post("/ops/nodes", { headers: OPS, data: { node_id: nodeId, owner_label: nodeId } });
  expect(res.status()).toBe(200);
  return ((await res.json()) as { token: string }).token;
}
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const enqueue = async (request: APIRequestContext, ids: string[]) =>
  expect((await request.post("/ops/jobs", { headers: OPS, data: { video_ids: ids } })).status()).toBe(200);
const claim = async (request: APIRequestContext, token: string): Promise<Lease[]> => {
  const res = await request.post("/node/claim", { headers: bearer(token), data: { max_jobs: 10 } });
  expect(res.status()).toBe(200);
  return ((await res.json()) as { jobs: Lease[] }).jobs;
};
const report = (request: APIRequestContext, token: string, lease: Lease, outcome: string) =>
  request.post("/node/result", { headers: bearer(token), data: { lease_id: lease.lease_id, outcome, transcript: null } });
const getJob = async (request: APIRequestContext, id: string) =>
  (await (await request.get(`/ops/jobs/${id}`, { headers: OPS })).json()) as Record<string, unknown>;

test.beforeEach(async ({ request }) => {
  expect((await request.post("/ops/reset", { headers: OPS })).status()).toBe(200);
});

test("E2E-14: an expired lease goes to another node and the late result gets 409", async ({ request }) => {
  const [a, b] = await Promise.all([enroll(request, "node-a"), enroll(request, "node-b")]);
  await enqueue(request, [videoId(1)]);
  const [first] = await claim(request, a);
  await new Promise((r) => setTimeout(r, LEASE_MS + 300));

  const [second] = await claim(request, b);
  expect(second?.video_id).toBe(videoId(1));
  const late = await report(request, a, first!, "no_transcript");
  expect(late.status()).toBe(409);
  expect(((await late.json()) as { error: { code: string } }).error.code).toBe("stale_lease");
  expect(await getJob(request, videoId(1))).toMatchObject({ status: "leased", leased_by: "node-b", attempts: 2 });

  expect((await report(request, b, second!, "no_transcript")).status()).toBe(200);
  expect(await getJob(request, videoId(1))).toMatchObject({ status: "done" });
});

test("E2E-16: unavailable on 3 nodes gives failed_video and a 4th node gets nothing", async ({ request }) => {
  const tokens = await Promise.all(["node-a", "node-b", "node-c", "node-d"].map((id) => enroll(request, id)));
  await enqueue(request, [videoId(1)]);
  for (const token of tokens.slice(0, 3)) {
    const [lease] = await claim(request, token);
    expect(lease?.video_id).toBe(videoId(1));
    expect((await report(request, token, lease!, "unavailable")).status()).toBe(200);
  }
  expect(await getJob(request, videoId(1))).toMatchObject({ status: "failed_video", attempts: 3, last_outcome: "unavailable" });
  expect(await claim(request, tokens[3]!)).toEqual([]);
});

test("E2E-20: a revoked node is refused and its job reassigned", async ({ request }) => {
  const [a, b] = await Promise.all([enroll(request, "node-a"), enroll(request, "node-b")]);
  await enqueue(request, [videoId(1)]);
  const [lease] = await claim(request, a);
  const revoked = await request.delete("/ops/nodes/node-a", { headers: OPS });
  expect(revoked.status()).toBe(200);
  expect(await revoked.json()).toEqual({ node_id: "node-a", state: "disabled" });

  expect((await request.post("/node/claim", { headers: bearer(a), data: {} })).status()).toBe(401);
  expect((await report(request, a, lease!, "no_transcript")).status()).toBe(401);
  expect(await getJob(request, videoId(1))).toMatchObject({ status: "queued", last_outcome: "lease_revoked" });
  const [again] = await claim(request, b);
  expect(again?.video_id).toBe(videoId(1));
});

test("E2E-21: /node/* responses hold no user data", async ({ request }) => {
  const token = await enroll(request, "node-a");
  await enqueue(request, [videoId(1), videoId(2)]);
  const bodies: unknown[] = [];
  const claimRes = await request.post("/node/claim", { headers: bearer(token), data: { max_jobs: 2 } });
  const claimed = (await claimRes.json()) as { jobs: Lease[] };
  bodies.push(claimed);
  bodies.push(await (await request.post("/node/heartbeat", { headers: bearer(token), data: { version: "1", uptime_s: 1, jobs_in_progress: 2 } })).json());
  bodies.push(await (await report(request, token, claimed.jobs[0]!, "no_transcript")).json());
  bodies.push(await (await request.post("/node/release", { headers: bearer(token), data: { lease_id: claimed.jobs[1]!.lease_id } })).json());
  bodies.push(await (await request.post("/node/result", { headers: bearer(token), data: { lease_id: "x", outcome: "ok", transcript: null } })).json());

  const allowed = new Set(["jobs", "video_id", "lease_id", "lease_expires_at", "status", "node_id", "state", "hourly_budget", "directive", "error", "code", "message"]);
  const keys = (value: unknown): string[] =>
    Array.isArray(value) ? value.flatMap(keys) : value !== null && typeof value === "object" ? Object.entries(value).flatMap(([k, v]) => [k, ...keys(v)]) : [];
  for (const body of bodies) for (const key of keys(body)) expect(allowed.has(key), key).toBe(true);
  expect(JSON.stringify(bodies)).not.toMatch(/@|transcript|owner|ytd_node_/);
});
