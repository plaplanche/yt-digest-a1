import { expect, test, type APIRequestContext } from "@playwright/test";

const REDIRECT = "http://127.0.0.1:9/callback";
const resource = `http://127.0.0.1:${process.env.WORKER_PORT ?? "8787"}/mcp`;

async function register(request: APIRequestContext): Promise<string> {
  const res = await request.post("/register", { data: { redirect_uris: [REDIRECT], client_name: "E2E client" } });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { client_id: string }).client_id;
}

const authorize = (request: APIRequestContext, params: Record<string, string>) =>
  request.get(`/authorize?${new URLSearchParams(params)}`, { maxRedirects: 0 });

test.beforeEach(async ({ request }) => {
  const res = await request.post("/ops/reset", { headers: { Authorization: `Bearer ${process.env.OPS_TOKEN ?? "ops-local"}` } });
  expect(res.status()).toBe(200);
});

// E2E-29
test("no PKCE, plain PKCE and a non-exact redirect_uri are refused", async ({ request }) => {
  const clientId = await register(request);
  const good = { response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: "abc", code_challenge_method: "S256", resource, state: "s1" };

  const ok = await authorize(request, good);
  expect(ok.status()).toBe(200);
  expect(await ok.text()).toContain('<button type="submit" name="decision" value="approve">');

  for (const bad of [{ code_challenge: "" }, { code_challenge_method: "plain" }, { code_challenge_method: "" }]) {
    const res = await authorize(request, { ...good, ...bad });
    expect(res.status()).toBe(302);
    const to = new URL(res.headers()["location"]!);
    expect(to.searchParams.get("error")).toBe("invalid_request");
    expect(to.searchParams.get("state")).toBe("s1");
  }
  const noPkce: Record<string, string> = { ...good };
  delete noPkce["code_challenge"];
  delete noPkce["code_challenge_method"];
  const missing = await authorize(request, noPkce);
  expect(missing.status()).toBe(302);
  expect(new URL(missing.headers()["location"]!).searchParams.get("error")).toBe("invalid_request");

  for (const uri of [`${REDIRECT}/`, `${REDIRECT}?x=1`, "http://127.0.0.1:9/other", "https://evil.test/callback"]) {
    const res = await authorize(request, { ...good, redirect_uri: uri });
    expect(res.status()).toBe(400);
    expect(res.headers()["location"]).toBeUndefined();
  }
});
