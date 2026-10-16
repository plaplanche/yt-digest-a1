import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations("migrations");

export default defineConfig({
  test: {
    projects: [
      {
        test: { name: "node", include: ["tests/**/*.test.ts"], exclude: ["tests/**/*.worker.test.ts"] },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.toml" },
            miniflare: { bindings: { OPS_TOKEN: "ops-test", MIGRATIONS: migrations } },
          }),
        ],
        test: { name: "worker", include: ["tests/**/*.worker.test.ts"], setupFiles: ["tests/setup.ts"] },
      },
    ],
  },
});
