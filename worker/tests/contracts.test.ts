import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, test } from "vitest";
import transcriptSchema from "../../contracts/transcript-result.schema.json";
import type { TranscriptResult } from "../src/contracts/transcript-result.js";

const validate = new Ajv2020({ strict: true }).compile<TranscriptResult>(transcriptSchema);

const valid: TranscriptResult = {
  video_id: "dQw4w9WgXcQ",
  status: "ok",
  lang: "en",
  source: "manual",
  word_count: 3,
  truncated: false,
  sponsor_ratio: 0.1,
  pages: ["one two three"],
};

test("a valid transcript result is accepted", () => {
  expect(validate(valid)).toBe(true);
});

test.each([
  ["an extra field", { ...valid, extra: 1 }],
  ["a bad video_id", { ...valid, video_id: "short" }],
  ["a bad status", { ...valid, status: "done" }],
])("a transcript result with %s is rejected", (_name, value) => {
  expect(validate(value)).toBe(false);
});

test("a no_transcript result with null lang, source and sponsor_ratio is accepted", () => {
  const result: TranscriptResult = {
    ...valid,
    status: "no_transcript",
    lang: null,
    source: null,
    word_count: 0,
    sponsor_ratio: null,
    pages: [],
  };
  expect(validate(result)).toBe(true);
});
