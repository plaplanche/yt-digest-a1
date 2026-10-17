import { expect, test, type APIRequestContext } from "@playwright/test";

const OPS = { Authorization: `Bearer ${process.env.OPS_TOKEN ?? "ops-local"}` };
const videoId = (n: number) => `e2eclaim${String(n).padStart(3, "0")}`;

async function enroll(request: APIRequestContext, nodeId: string): Promise<string> {
  const res = await request.post("/ops/nodes", { headers: OPS, data: { node_id: nodeId, owner_label: nodeId } });
  expect(res.status()).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

test.beforeEach(async ({ request }) => {
  expect((await request.post("/ops/reset", { headers: OPS })).status()).toBe(200);
});

test("2 nodes claim 6 jobs concurrently: each job is handed out once", async ({ request }) => {
  const tokens = await Promise.all(["node-a", "node-b"].map((id) => enroll(request, id)));
  const ids = Array.from({ length: 6 }, (_, i) => videoId(i));
  expect((await request.post("/ops/jobs", { headers: OPS, data: { video_ids: ids } })).status()).toBe(200);

  const claims = await Promise.all(
    [...tokens, ...tokens].map(async (token) => {
      const res = await request.post("/node/claim", { headers: { Authorization: `Bearer ${token}` }, data: { max_jobs: 3 } });
      expect(res.status()).toBe(200);
      const jobs = ((await res.json()) as { jobs: { video_id: string; lease_id: string }[] }).jobs;
      return jobs.map((j) => ({ ...j, token }));
    }),
  );

  const handed = claims.flat().map((j) => j.video_id);
  expect(handed.sort()).toEqual(ids);
  expect(claims.reduce((n, c) => n + c.length, 0)).toBe(6);
  for (const id of ids) {
    const job = (await (await request.get(`/ops/jobs/${id}`, { headers: OPS })).json()) as { status: string; attempts: number; tried_nodes: string[] };
    expect(job).toMatchObject({ status: "leased", attempts: 1 });
    expect(job.tried_nodes).toHaveLength(1);
  }

  // each node reports its jobs: all 6 end done
  for (const job of claims.flat()) {
    const res = await request.post("/node/result", {
      headers: { Authorization: `Bearer ${job.token}` },
      data: { lease_id: job.lease_id, outcome: "no_transcript", transcript: null },
    });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ video_id: job.video_id, status: "done" });
  }
  for (const id of ids) {
    const job = (await (await request.get(`/ops/jobs/${id}`, { headers: OPS })).json()) as { status: string };
    expect(job.status).toBe("done");
  }
});
