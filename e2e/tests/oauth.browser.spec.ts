import { createHash } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";

const workerUrl = `http://127.0.0.1:${process.env.WORKER_PORT ?? "8787"}`;
const OPS = { Authorization: `Bearer ${process.env.OPS_TOKEN ?? "ops-local"}` };
// The client's redirect URI is a page the Worker serves, so the browser can land on it.
const REDIRECT = `${workerUrl}/health`;
const challenge = createHash("sha256").update("verifier").digest("base64url");

async function startAuthorization(request: APIRequestContext): Promise<string> {
  const res = await request.post("/register", { data: { redirect_uris: [REDIRECT], client_name: "E2E client" } });
  expect(res.status()).toBe(201);
  const { client_id: clientId } = (await res.json()) as { client_id: string };
  const params = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", resource: `${workerUrl}/mcp`, state: "st-browser" });
  return `/authorize?${params}`;
}

async function signIn(page: import("@playwright/test").Page, email: string): Promise<void> {
  await page.getByRole("button", { name: "Approve" }).click();
  await page.waitForURL(/\/google\/authorize/);
  await page.locator('input[name="login_hint"]').fill(email);
  await page.locator('[type="submit"]').click();
}

test.beforeEach(async ({ request }) => {
  expect((await request.post("/ops/reset", { headers: OPS })).status()).toBe(200);
});

test("an invited user goes through consent and the fake Google page and comes back with a code", async ({ page, request }) => {
  expect((await request.post("/ops/invites", { headers: OPS, data: { email: "bob@test" } })).status()).toBe(200);
  await page.goto(await startAuthorization(request));
  await expect(page.getByText("E2E client")).toBeVisible();
  await signIn(page, "bob@test");
  await page.waitForURL(/\/health\?code=/);
  const back = new URL(page.url());
  expect(back.searchParams.get("code")).toBeTruthy();
  expect(back.searchParams.get("state")).toBe("st-browser");

  const users = (await (await request.get("/ops/users", { headers: OPS })).json()) as { users: { email: string; role: string }[] };
  expect(users.users).toEqual([expect.objectContaining({ email: "bob@test", role: "member" })]);
});

test("E2E-02: a non-invited user gets the 403 page and no users row", async ({ page, request }) => {
  await page.goto(await startAuthorization(request));
  await signIn(page, "mallory@test");
  await expect(page).toHaveTitle("Access refused");
  await expect(page.getByText("This account is not invited.")).toBeVisible();
  expect(page.url()).toContain("/callback");

  const users = (await (await request.get("/ops/users", { headers: OPS })).json()) as { users: unknown[] };
  expect(users.users).toEqual([]);
});
