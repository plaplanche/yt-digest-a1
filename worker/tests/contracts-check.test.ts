import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const repo = resolve(import.meta.dirname, "../..");
const generated = "worker/src/contracts/log-event.ts";
// --check regenerates every schema in both languages
vi.setConfig({ testTimeout: 120_000 });

let copy: string;

function check() {
  return spawnSync(join(repo, "scripts/contracts.sh"), ["--check"], {
    env: { ...process.env, CONTRACTS_ROOT: copy },
    encoding: "utf8",
  });
}

beforeEach(() => {
  copy = mkdtempSync(join(tmpdir(), "contracts-"));
  cpSync(join(repo, "contracts"), join(copy, "contracts"), { recursive: true });
  cpSync(join(repo, "node/src/yt_digest_node/contracts"), join(copy, "node/src/yt_digest_node/contracts"), { recursive: true });
  cpSync(join(repo, "worker/src/contracts"), join(copy, "worker/src/contracts"), { recursive: true });
  // the generators run from the real project directories
  execFileSync("ln", ["-s", join(repo, "worker/node_modules"), join(copy, "worker/node_modules")]);
  cpSync(join(repo, "worker/package.json"), join(copy, "worker/package.json"));
  execFileSync("cp", ["-r", join(repo, "node/pyproject.toml"), join(repo, "node/uv.lock"), join(copy, "node/")]);
  cpSync(join(repo, "node/src/yt_digest_node/__init__.py"), join(copy, "node/src/yt_digest_node/__init__.py"));
});

afterEach(() => rmSync(copy, { recursive: true, force: true }));

test("--check passes on a fresh tree", () => {
  expect(check().status).toBe(0);
});

test("--check names a generated file edited by hand", () => {
  writeFileSync(join(copy, generated), readFileSync(join(copy, generated), "utf8") + "// hand edit\n");
  const r = check();
  expect(r.status).toBe(1);
  expect(r.stderr).toContain(generated);
});

test("--check fails when a schema changes without regeneration", () => {
  const schema = join(copy, "contracts/log-event.schema.json");
  writeFileSync(schema, readFileSync(schema, "utf8").replace('"sponsorblock.call"', '"sponsorblock.call", "extra.event"'));
  const r = check();
  expect(r.status).toBe(1);
  expect(r.stderr).toContain(generated);
  expect(r.stderr).toContain("node/src/yt_digest_node/contracts/log_event.py");
});
