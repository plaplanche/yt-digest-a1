import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, test } from "vitest";
import errorSchema from "../../contracts/error.schema.json";
import claimRequest from "../../contracts/node-claim-request.schema.json";
import claimResponse from "../../contracts/node-claim-response.schema.json";
import heartbeatRequest from "../../contracts/node-heartbeat-request.schema.json";
import heartbeatResponse from "../../contracts/node-heartbeat-response.schema.json";
import jobAck from "../../contracts/node-job-ack.schema.json";
import releaseRequest from "../../contracts/node-release-request.schema.json";
import resultRequest from "../../contracts/node-result-request.schema.json";
import transcriptSchema from "../../contracts/transcript-result.schema.json";

const ajv = new Ajv2020({ strict: true, schemas: [transcriptSchema] });
// the $ref of node-result-request is relative to the schema file name
ajv.addSchema(transcriptSchema, "transcript-result.schema.json");
const compile = (schema: object) => ajv.compile(schema);

const transcript = {
  video_id: "dQw4w9WgXcQ",
  status: "ok",
  lang: "en",
  source: "manual",
  word_count: 3,
  truncated: false,
  sponsor_ratio: 0.1,
  pages: ["one two three"],
};
const lease = { video_id: "dQw4w9WgXcQ", lease_id: "0123456789abcdef", lease_expires_at: "2026-10-16T07:00:01.123Z" };

const cases: Record<string, { schema: object; valid: object; invalid: [string, object][] }> = {
  heartbeatRequest: {
    schema: heartbeatRequest,
    valid: {
      version: "0.1.0",
      uptime_s: 5,
      jobs_in_progress: 0,
      last_success_at: null,
      last_blocked_at: "2026-10-16T07:00:01.123Z",
      disk_free_ratio: 0.5,
      cpu_temp_c: 40.5,
    },
    invalid: [
      ["an extra field", { version: "1", uptime_s: 0, jobs_in_progress: 0, extra: 1 }],
      ["no version", { uptime_s: 0, jobs_in_progress: 0 }],
      ["an empty version", { version: "", uptime_s: 0, jobs_in_progress: 0 }],
      ["a negative uptime", { version: "1", uptime_s: -1, jobs_in_progress: 0 }],
      ["a bad ratio", { version: "1", uptime_s: 0, jobs_in_progress: 0, disk_free_ratio: 1.5 }],
    ],
  },
  heartbeatResponse: {
    schema: heartbeatResponse,
    valid: { node_id: "n1", state: "healthy", hourly_budget: 10, directive: "run" },
    invalid: [
      ["an extra field", { node_id: "n1", state: "healthy", hourly_budget: 10, directive: "run", extra: 1 }],
      ["an unknown state", { node_id: "n1", state: "sleepy", hourly_budget: 10, directive: "run" }],
    ],
  },
  claimRequest: {
    schema: claimRequest,
    valid: { max_jobs: 3 },
    invalid: [
      ["an extra field", { extra: 1 }],
      ["max_jobs 0", { max_jobs: 0 }],
      ["max_jobs 11", { max_jobs: 11 }],
    ],
  },
  claimResponse: {
    schema: claimResponse,
    valid: { jobs: [lease] },
    invalid: [
      ["an extra field", { jobs: [], extra: 1 }],
      ["a short lease_id", { jobs: [{ ...lease, lease_id: "short" }] }],
    ],
  },
  resultRequest: {
    schema: resultRequest,
    valid: { lease_id: "l", outcome: "ok", transcript },
    invalid: [
      ["an extra field", { lease_id: "l", outcome: "ok", transcript, extra: 1 }],
      ["an unknown outcome", { lease_id: "l", outcome: "maybe", transcript }],
      ["a broken transcript", { lease_id: "l", outcome: "ok", transcript: { ...transcript, status: "done" } }],
    ],
  },
  releaseRequest: {
    schema: releaseRequest,
    valid: { lease_id: "l" },
    invalid: [
      ["an extra field", { lease_id: "l", extra: 1 }],
      ["an empty lease_id", { lease_id: "" }],
    ],
  },
  jobAck: {
    schema: jobAck,
    valid: { video_id: "dQw4w9WgXcQ", status: "failed_video" },
    invalid: [
      ["an extra field", { video_id: "dQw4w9WgXcQ", status: "done", extra: 1 }],
      ["an unknown status", { video_id: "dQw4w9WgXcQ", status: "nope" }],
    ],
  },
  error: {
    schema: errorSchema,
    valid: { error: { code: "x", message: "y" } },
    invalid: [
      ["an extra field", { error: { code: "x", message: "y", extra: 1 } }],
      ["a missing message", { error: { code: "x" } }],
    ],
  },
};

for (const [name, { schema, valid, invalid }] of Object.entries(cases)) {
  const validate = compile(schema);
  test(`${name}: a valid instance is accepted`, () => {
    expect(validate(valid)).toBe(true);
  });
  test.each(invalid)(`${name}: %s is rejected`, (_what, value) => {
    expect(validate(value)).toBe(false);
  });
}

test("a result with a null transcript is accepted", () => {
  expect(compile(resultRequest)({ lease_id: "l", outcome: "error", transcript: null })).toBe(true);
  expect(compile(resultRequest)({ lease_id: "l", outcome: "error" })).toBe(false);
});

test("the generated result-request type uses the generated transcript-result type", () => {
  const src = readFileSync(new URL("../src/contracts/node-result-request.ts", import.meta.url), "utf8");
  expect(src).toMatch(/import type \{\s*TranscriptResult\s*\} from "\.\/transcript-result\.js"/);
  expect(src).not.toMatch(/interface TranscriptResult/);
});
