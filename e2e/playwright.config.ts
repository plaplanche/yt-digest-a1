import { defineConfig, devices } from "@playwright/test";

const workerPort = process.env.WORKER_PORT ?? "8787";
const mocksPort = process.env.MOCKS_PORT ?? "8789";

export default defineConfig({
  testDir: "tests",
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: `http://127.0.0.1:${workerPort}` },
  metadata: { mocksUrl: `http://127.0.0.1:${mocksPort}` },
  projects: [
    { name: "api", testMatch: /.*\.api\.spec\.ts/ },
    { name: "browser", testMatch: /.*\.browser\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
  ],
});
