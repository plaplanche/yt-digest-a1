import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, test, vi } from "vitest";
import worker from "../src/index.js";
import { sha256Hex } from "../src/crypto.js";

const BASE = "http://worker.test";
const call = (path: string, init?: RequestInit) => worker.fetch(new Request(`${BASE}${path}`, init), env);
const ops = (path: string, body: unknown) => call(path, { method: "POST", headers: { Authorization: "Bearer ops-test" }, body: JSON.stringify(body) });
const rpc = (body: unknown, headers: Record<string, string> = {}) =>
  call("/mcp", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify(body) });

/** Stores an access token as the token endpoint would. */
async function seedAccess(over: { expiresInMs?: number; userSub?: string } = {}): Promise<string> {
  const access = `access-${crypto.randomUUID()}`;
  await env.DB.prepare(
    "INSERT INTO oauth_tokens (token_hash, kind, client_id, user_sub, family_id, scope, resource, expires_at) VALUES (?, 'access', 'c1', ?, 'f1', 'digest', ?, ?)",
  )
    .bind(await sha256Hex(access), over.userSub ?? "sub-bob", `${BASE}/mcp`, new Date(Date.now() + (over.expiresInMs ?? 60000)).toISOString())
    .run();
  return access;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const PING = { jsonrpc: "2.0", id: 1, method: "ping" };

beforeEach(async () => {
  expect((await ops("/ops/reset", {})).status).toBe(200);
  await ops("/ops/invites", { email: "bob@test" });
  await env.DB.prepare("INSERT INTO users (user_sub, email, role, created_at) VALUES ('sub-bob', 'bob@test', 'member', ?)").bind(new Date().toISOString()).run();
});

function expectChallenge(res: Response): void {
  expect(res.status).toBe(401);
  expect(res.headers.get("WWW-Authenticate")).toBe(`Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource"`);
}

describe("authentication", () => {
  test("no token", async () => {
    const res = await rpc(PING);
    expectChallenge(res);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_token");
  });

  test("an expired access token", async () => {
    expectChallenge(await rpc(PING, auth(await seedAccess({ expiresInMs: -1000 }))));
  });

  test("a node token and the operator token", async () => {
    const enrolled = await ops("/ops/nodes", { node_id: "n1", owner_label: "n1" });
    const nodeToken = ((await enrolled.json()) as { token: string }).token;
    expectChallenge(await rpc(PING, auth(nodeToken)));
    expectChallenge(await rpc(PING, auth("ops-test")));
  });

  test("a user whose invite was revoked", async () => {
    const access = await seedAccess();
    expect((await rpc(PING, auth(access))).status).toBe(200);
    expect((await ops("/ops/invites/revoke", { email: "bob@test" })).status).toBe(200);
    expectChallenge(await rpc(PING, auth(access)));
  });

  test("an access token on /node/*", async () => {
    const res = await call("/node/heartbeat", { method: "POST", headers: auth(await seedAccess()), body: "{}" });
    expect(res.status).toBe(401);
  });
});

describe("origin", () => {
  test("a foreign origin is 403 before authentication", async () => {
    const res = await rpc(PING, { Origin: "http://evil.test" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("origin_rejected");
  });

  test("the origin of BASE and an absent origin pass", async () => {
    const token = auth(await seedAccess());
    expect((await rpc(PING, { ...token, Origin: BASE })).status).toBe(200);
    expect((await rpc(PING, token)).status).toBe(200);
  });

  test("an origin of ALLOWED_ORIGINS passes", async () => {
    const token = auth(await seedAccess());
    const res = await worker.fetch(
      new Request(`${BASE}/mcp`, { method: "POST", headers: { ...token, Origin: "http://client.test" }, body: JSON.stringify(PING) }),
      { ...env, ALLOWED_ORIGINS: "http://other.test, http://client.test" },
    );
    expect(res.status).toBe(200);
  });
});

describe("protocol", () => {
  test("initialize, notification, ping, tools/list, tools/call", async () => {
    const token = auth(await seedAccess());
    const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } }, token);
    expect(init.headers.get("Content-Type")).toBe("application/json");
    expect(((await init.json()) as { id: number; result: { protocolVersion: string } }).result.protocolVersion).toBe("2025-06-18");

    const note = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" }, token);
    expect(note.status).toBe(202);
    expect(await note.text()).toBe("");

    expect(((await (await rpc(PING, token)).json()) as { result: unknown }).result).toEqual({});

    const list = (await (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, token)).json()) as { result: { tools: { name: string; inputSchema: unknown }[] } };
    expect(list.result.tools.map((t) => t.name)).toEqual(["list_subscriptions"]);
    expect(list.result.tools[0]!.inputSchema).toEqual({ type: "object", properties: {} });

    const called = (await (await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_subscriptions", arguments: {} } }, token)).json()) as {
      result: { isError: boolean; content: { type: string; text: string }[] };
    };
    expect(called.result.isError).toBe(false);
    expect(called.result.content).toEqual([{ type: "text", text: '{"subscriptions":[]}' }]);
  });

  test("an unknown tool and an unknown method are JSON-RPC errors", async () => {
    const token = auth(await seedAccess());
    const tool = (await (await rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "nope" } }, token)).json()) as { error: { code: number } };
    expect(tool.error.code).toBe(-32602);
    const method = (await (await rpc({ jsonrpc: "2.0", id: 2, method: "nope" }, token)).json()) as { error: { code: number } };
    expect(method.error.code).toBe(-32601);
  });

  test("a body that is not a JSON-RPC message is 400, a GET is 404", async () => {
    const token = auth(await seedAccess());
    expect((await call("/mcp", { method: "POST", headers: token, body: "{" })).status).toBe(400);
    expect((await rpc([PING], token)).status).toBe(400);
    expect((await call("/mcp", { method: "GET", headers: token })).status).toBe(404);
  });
});

describe("validation", () => {
  test("a missing jsonrpc and a null id are 400; a string id is echoed", async () => {
    const token = auth(await seedAccess());
    expect((await rpc({ id: 1, method: "ping" }, token)).status).toBe(400);
    expect((await rpc({ jsonrpc: "2.0", id: null, method: "ping" }, token)).status).toBe(400);
    const res = await rpc({ jsonrpc: "2.0", id: "abc", method: "ping" }, token);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "abc", result: {} });
  });
});

describe("log events", () => {
  type Line = { event: string; level: string; attrs: Record<string, unknown> };
  async function logged(run: () => Promise<void>): Promise<Line[]> {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await run();
    const lines = spy.mock.calls.map(([l]) => JSON.parse(String(l)) as Line);
    spy.mockRestore();
    return lines;
  }

  test("auth.origin.rejected", async () => {
    const lines = await logged(async () => void (await rpc(PING, { Origin: "http://evil.test" })));
    const line = lines.find((l) => l.event === "auth.origin.rejected");
    expect(line).toMatchObject({ level: "warn", attrs: { origin: "http://evil.test" } });
  });

  test("auth.bearer.rejected with surface mcp and each reason", async () => {
    const expired = await seedAccess({ expiresInMs: -1000 });
    const revoked = await seedAccess();
    await ops("/ops/invites/revoke", { email: "bob@test" });
    const lines = await logged(async () => {
      await rpc(PING);
      await rpc(PING, auth("nope"));
      await rpc(PING, auth(expired));
      await rpc(PING, auth(revoked));
    });
    const rejected = lines.filter((l) => l.event === "auth.bearer.rejected");
    expect(rejected.every((l) => l.level === "warn")).toBe(true);
    expect(rejected.map((l) => l.attrs)).toEqual([
      { surface: "mcp", reason: "missing" },
      { surface: "mcp", reason: "unknown" },
      { surface: "mcp", reason: "expired" },
      { surface: "mcp", reason: "revoked" },
    ]);
  });

  test("mcp.tool.call with outcome ok and error; the raw name of an unknown tool is not logged", async () => {
    const token = auth(await seedAccess());
    const lines = await logged(async () => {
      await rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_subscriptions" } }, token);
      await rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "bob@test" } }, token);
    });
    const calls = lines.filter((l) => l.event === "mcp.tool.call");
    expect(calls).toHaveLength(2);
    expect(calls[0]!.attrs).toMatchObject({ tool: "list_subscriptions", outcome: "ok" });
    expect(typeof calls[0]!.attrs["duration_ms"]).toBe("number");
    expect(calls[1]!.attrs).toMatchObject({ tool: "unknown", outcome: "error" });
  });
});
