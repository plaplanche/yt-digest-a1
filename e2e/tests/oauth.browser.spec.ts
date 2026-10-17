import { createHash, randomBytes } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const OPS = { Authorization: `Bearer ${process.env.OPS_TOKEN ?? "ops-local"}` };
const REDIRECT = "http://127.0.0.1:54321/callback";
const resource = `http://127.0.0.1:${process.env.WORKER_PORT ?? "8787"}/mcp`;

test.beforeEach(async ({ request }) => {
  expect((await request.post("/ops/reset", { headers: OPS })).status()).toBe(200);
});

/** Registers a client and opens the consent page; the client's redirect URI is answered by the test itself. */
async function startAuthorization(request: APIRequestContext, page: Page): Promise<void> {
  const reg = await request.post("/register", { data: { redirect_uris: [REDIRECT], client_name: "Browser client" } });
  const clientId = ((await reg.json()) as { client_id: string }).client_id;
  const challenge = createHash("sha256").update(randomBytes(32)).digest("base64url");
  await page.route(`${REDIRECT}**`, (route) => route.fulfill({ status: 200, contentType: "text/plain", body: "client" }));
  const query = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", resource, state: "browser-state" });
  await page.goto(`/authorize?${query}`);
  await expect(page.getByText("Browser client")).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.locator('input[name="login_hint"]').fill(email);
  await page.locator('[type="submit"]').click();
}

test("an invited user goes through consent and the fake Google page and comes back with a code", async ({ request, page }) => {
  await request.post("/ops/invites", { headers: OPS, data: { email: "bob@test" } });
  await startAuthorization(request, page);
  await signIn(page, "bob@test");
  await page.waitForURL(`${REDIRECT}**`);
  const back = new URL(page.url());
  expect(back.searchParams.get("code")).toBeTruthy();
  expect(back.searchParams.get("state")).toBe("browser-state");
  const users = (await (await request.get("/ops/users", { headers: OPS })).json()) as { users: { email: string; role: string }[] };
  expect(users.users).toEqual([expect.objectContaining({ email: "bob@test", role: "member" })]);
});

// E2E-02
test("a non-invited user gets the 403 page and no users row", async ({ request, page }) => {
  await startAuthorization(request, page);
  await signIn(page, "mallory@test");
  await expect(page).toHaveTitle("Access refused");
  await expect(page.getByText("This account is not invited.")).toBeVisible();
  const users = (await (await request.get("/ops/users", { headers: OPS })).json()) as { users: unknown[] };
  expect(users.users).toEqual([]);
});
