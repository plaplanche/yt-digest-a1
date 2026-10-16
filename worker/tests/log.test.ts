import { afterEach, expect, test, vi } from "vitest";
import type { LogEventName } from "../src/contracts/log-event.js";
import { log } from "../src/log.js";

afterEach(() => vi.restoreAllMocks());

test("a catalogued event is written as one JSON line", () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  log("service.started", { attrs: { version: "0.1.0" } });
  expect(spy).toHaveBeenCalledTimes(1);
  const line = JSON.parse(String(spy.mock.calls[0]?.[0]));
  expect(line).toMatchObject({ level: "info", service: "worker", event: "service.started", attrs: { version: "0.1.0" } });
  expect(line.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test("an event outside the catalogue throws", () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(() => log("nope.event" as LogEventName)).toThrow();
  expect(spy).not.toHaveBeenCalled();
});

test("an unknown field throws", () => {
  expect(() => log("service.started", { bogus: 1 } as never)).toThrow();
});
