import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";

const run = promisify(execFile);
const OPS = { Authorization: `Bearer ${process.env.OPS_TOKEN ?? "ops-local"}` };
const root = resolve(import.meta.dirname, "../..");
const workerUrl = `http://127.0.0.1:${process.env.WORKER_PORT ?? "8787"}`;
const mocksUrl = `http://127.0.0.1:${process.env.MOCKS_PORT ?? "8789"}`;

test.beforeEach(async ({ request }) => {
  expect((await request.post("/ops/reset", { headers: OPS })).status()).toBe(200);
});

test("yt-digest-node work --once processes a queued video and its transcript is readable", async ({ request }) => {
  const enrolled = await request.post("/ops/nodes", { headers: OPS, data: { node_id: "node-daemon", owner_label: "daemon" } });
  const token = ((await enrolled.json()) as { token: string }).token;
  expect((await request.post("/ops/jobs", { headers: OPS, data: { video_ids: ["okokokokok1"] } })).status()).toBe(200);

  const { stderr } = await run("uv", ["run", "--project", "node", "yt-digest-node", "work", "--once"], {
    cwd: root,
    env: {
      ...process.env,
      WORKER_URL: workerUrl,
      NODE_TOKEN: token,
      FETCHER_FAKE_YTDLP: "1",
      FAKE_YTDLP_DIR: resolve(root, "node/tests/fixtures/cli"),
      SPONSORBLOCK_URL: `${mocksUrl}/sponsorblock`,
    },
  });
  expect(stderr).not.toContain(token);

  const job = (await (await request.get("/ops/jobs/okokokokok1", { headers: OPS })).json()) as { status: string };
  expect(job.status).toBe("done");
  const res = await request.get("/ops/transcripts/okokokokok1", { headers: OPS });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { node_id: string; transcript: { status: string; lang: string; pages: string[] } };
  expect(body.node_id).toBe("node-daemon");
  expect(body.transcript).toMatchObject({ status: "ok", lang: "en" });
  expect(body.transcript.pages.join("\n")).toContain("Hello and welcome.");
});
