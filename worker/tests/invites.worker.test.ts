import { env } from "cloudflare:workers";
import { Ajv2020 } from "ajv/dist/2020.js";
import { beforeEach, describe, expect, test } from "vitest";
import errorSchema from "../../contracts/error.schema.json";
import worker from "../src/index.js";

const validateError = new Ajv2020({ strict: true }).compile(errorSchema);

const ops = (path: string, body?: unknown, method = body === undefined ? "GET" : "POST") =>
  worker.fetch(
    new Request(`http://worker.test${path}`, { method, headers: { Authorization: "Bearer ops-test" }, body: body === undefined ? undefined : JSON.stringify(body) }),
    env,
  );

beforeEach(async () => {
  expect((await ops("/ops/reset", {})).status).toBe(200);
});

describe("invites", () => {
  test("an invite is stored lowercased", async () => {
    const res = await ops("/ops/invites", { email: "Bob@Test" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: "bob@test", revoked: false });
    const row = await env.DB.prepare("SELECT email, revoked, accepted_user_sub FROM invites").first();
    expect(row).toEqual({ email: "bob@test", revoked: 0, accepted_user_sub: null });
  });

  test("an e-mail without @ is invalid", async () => {
    const res = await ops("/ops/invites", { email: "bob" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(validateError(body)).toBe(true);
    expect(body).toMatchObject({ error: { code: "invalid_request" } });
  });

  test("inviting again re-activates a revoked invite", async () => {
    await ops("/ops/invites", { email: "bob@test" });
    const revoked = await ops("/ops/invites/revoke", { email: "BOB@test" });
    expect(await revoked.json()).toEqual({ email: "bob@test", revoked: true });
    expect(await env.DB.prepare("SELECT revoked FROM invites").first()).toEqual({ revoked: 1 });
    const again = await ops("/ops/invites", { email: "bob@test" });
    expect(await again.json()).toEqual({ email: "bob@test", revoked: false });
    expect(await env.DB.prepare("SELECT revoked FROM invites").all().then((r) => r.results)).toEqual([{ revoked: 0 }]);
  });

  test("revoking an unknown invite gives 404 not_found", async () => {
    const res = await ops("/ops/invites/revoke", { email: "nobody@test" });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(validateError(body)).toBe(true);
    expect(body).toMatchObject({ error: { code: "not_found" } });
  });

  test("they need the operator token", async () => {
    const res = await worker.fetch(new Request("http://worker.test/ops/invites", { method: "POST", body: "{}" }), env);
    expect(res.status).toBe(401);
  });
});

describe("GET /ops/users", () => {
  test("lists users sorted by e-mail", async () => {
    expect(await (await ops("/ops/users")).json()).toEqual({ users: [] });
    const insert = env.DB.prepare("INSERT INTO users (user_sub, email, role, created_at) VALUES (?, ?, ?, '2026-10-17T00:00:00.000Z')");
    await env.DB.batch([insert.bind("g-2", "bob@test", "member"), insert.bind("g-1", "alice@test", "admin"), insert.bind("g-3", "carol@test", "member")]);
    expect(await (await ops("/ops/users")).json()).toEqual({
      users: [
        { user_sub: "g-1", email: "alice@test", role: "admin" },
        { user_sub: "g-2", email: "bob@test", role: "member" },
        { user_sub: "g-3", email: "carol@test", role: "member" },
      ],
    });
  });
});
