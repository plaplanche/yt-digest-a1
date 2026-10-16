import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, test } from "vitest";
import errorSchema from "../../contracts/error.schema.json";
import { Ajv2020 } from "ajv/dist/2020.js";
import pkg from "../package.json";
import worker from "../src/index.js";

const validateError = new Ajv2020({ strict: true }).compile(errorSchema);
const call = (path: string, init?: RequestInit) => worker.fetch(new Request(`http://worker.test${path}`, init), env);
const ops = (path: string, init: RequestInit = {}, token = "ops-test") =>
  call(path, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } });

async function expectError(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get("Content-Type")).toBe("application/json");
  const body = await res.json();
  expect(validateError(body)).toBe(true);
  expect((body as { error: { code: string } }).error.code).toBe(code);
}

const COLUMNS: Record<string, string[]> = {
  nodes: ["node_id", "owner_label", "token_hash", "state", "state_since", "last_heartbeat_at", "version", "hourly_budget", "created_at", "revoked_at"],
  jobs: ["video_id", "kind", "priority", "status", "leased_by", "lease_id", "lease_expires_at", "attempts", "tried_nodes", "last_outcome", "created_at", "done_at"],
  leases: ["lease_id", "video_id", "node_id", "issued_at", "expires_at", "state", "response_json"],
  node_events: ["node_id", "ts", "kind", "video_id"],
  invites: ["email", "invited_at", "accepted_user_sub", "revoked"],
  users: ["user_sub", "email", "role", "google_refresh_token_enc", "created_at"],
  oauth_clients: ["client_id", "client_name", "redirect_uris", "created_at"],
  oauth_requests: ["request_id", "client_id", "redirect_uri", "client_state", "code_challenge", "scope", "resource", "google_state", "google_nonce", "expires_at", "used_at"],
  oauth_codes: ["code_hash", "client_id", "user_sub", "redirect_uri", "code_challenge", "scope", "resource", "expires_at", "used_at"],
  oauth_tokens: ["token_hash", "kind", "client_id", "user_sub", "family_id", "scope", "resource", "expires_at", "used_at", "revoked_at"],
};

describe("migrations", () => {
  test.each(Object.entries(COLUMNS))("table %s has its columns", async (table, columns) => {
    const { results } = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
    expect(results.map((r) => r.name)).toEqual(expect.arrayContaining(columns));
  });

  test("defaults of nodes and jobs", async () => {
    await env.DB.exec("INSERT INTO nodes (node_id, owner_label, token_hash, state, state_since, created_at) VALUES ('n', 'o', 'h', 'healthy', 't', 't')");
    expect((await env.DB.prepare("SELECT hourly_budget FROM nodes").first<{ hourly_budget: number }>())?.hourly_budget).toBe(60);
    await env.DB.exec("DELETE FROM nodes");
  });
});

describe("conventions", () => {
  test("GET /health", async () => {
    const res = await call("/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(await res.json()).toEqual({ status: "ok", version: pkg.version });
  });

  test.each([
    ["GET", "/nope"],
    ["POST", "/health"],
    ["GET", "/"],
  ])("%s %s is 404 not_found", async (method, path) => {
    await expectError(await call(path, { method }), 404, "not_found");
  });
});

describe("/ops authentication", () => {
  test.each([
    ["no bearer", undefined],
    ["wrong bearer", "Bearer nope"],
    ["wrong scheme", "Basic ops-test"],
  ])("%s gives 401, whatever the body", async (_name, authorization) => {
    for (const body of [undefined, "{not json", '{"ok":1}']) {
      const headers: Record<string, string> = authorization ? { Authorization: authorization } : {};
      await expectError(await call("/ops/reset", { method: "POST", headers, body }), 401, "unauthorized");
    }
    await expectError(await call("/ops/unknown", { headers: authorization ? { Authorization: authorization } : {} }), 401, "unauthorized");
  });

  test("authenticated unknown route is 404", async () => {
    await expectError(await ops("/ops/unknown"), 404, "not_found");
    await expectError(await ops("/ops/reset"), 404, "not_found");
  });
});

describe("/ops disabled", () => {
  test("404 when OPS_TOKEN is empty", async () => {
    const empty = { ...env, OPS_TOKEN: "" } as Cloudflare.Env;
    const req = () => new Request("http://worker.test/ops/reset", { method: "POST", headers: { Authorization: "Bearer " } });
    await expectError(await worker.fetch(req(), empty), 404, "not_found");
    const unset = { ...env, OPS_TOKEN: undefined } as Cloudflare.Env;
    await expectError(await worker.fetch(req(), unset), 404, "not_found");
  });
});

describe("POST /ops/reset", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM nodes");
  });

  test("empties every table and every transcript object", async () => {
    await env.DB.exec("INSERT INTO nodes (node_id, owner_label, token_hash, state, state_since, created_at) VALUES ('n', 'o', 'h', 'healthy', 't', 't')");
    await env.DB.exec("INSERT INTO jobs (video_id, kind, status, created_at) VALUES ('aaaaaaaaaaa', 'primary', 'queued', 't')");
    await env.DB.exec("INSERT INTO leases (lease_id, video_id, node_id, issued_at, expires_at, state) VALUES ('l', 'v', 'n', 't', 't', 'active')");
    await env.DB.exec("INSERT INTO node_events (node_id, ts, kind) VALUES ('n', 't', 'job_ok')");
    await env.DB.exec("INSERT INTO invites (email, invited_at) VALUES ('a@b', 't')");
    await env.DB.exec("INSERT INTO users (user_sub, email, role, created_at) VALUES ('s', 'a@b', 'admin', 't')");
    await env.DB.exec("INSERT INTO oauth_clients (client_id, redirect_uris, created_at) VALUES ('c', '[]', 't')");
    await env.DB.exec("INSERT INTO oauth_requests (request_id, client_id, redirect_uri, code_challenge, expires_at) VALUES ('r', 'c', 'u', 'x', 't')");
    await env.DB.exec("INSERT INTO oauth_codes (code_hash, client_id, user_sub, redirect_uri, code_challenge, expires_at) VALUES ('h', 'c', 's', 'u', 'x', 't')");
    await env.DB.exec("INSERT INTO oauth_tokens (token_hash, kind, client_id, user_sub, family_id, expires_at) VALUES ('h', 'access', 'c', 's', 'f', 't')");
    for (let i = 0; i < 3; i++) await env.TRANSCRIPTS.put(`transcripts/v${i}.json`, "{}");
    await env.TRANSCRIPTS.put("other/keep.json", "{}");

    const res = await ops("/ops/reset", { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(await res.json()).toEqual({ ok: true });

    for (const table of Object.keys(COLUMNS)) {
      const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
      expect(row?.n, table).toBe(0);
    }
    expect((await env.TRANSCRIPTS.list({ prefix: "transcripts/" })).objects).toHaveLength(0);
    expect((await env.TRANSCRIPTS.list({ prefix: "other/" })).objects).toHaveLength(1);
    await env.TRANSCRIPTS.delete("other/keep.json");
  });
});
