import { Ajv2020 } from "ajv/dist/2020.js";
import logEventSchema from "../../contracts/log-event.schema.json";
import type { LogEvent, LogEventName } from "./contracts/log-event.js";

export type LogFields = Partial<Pick<LogEvent, "level" | "request_id" | "video_id" | "attrs">>;

const validate = new Ajv2020({ strict: true }).compile<LogEvent>(logEventSchema);

/** Writes one JSON line on standard error; throws on an event outside the catalogue or an unknown field. */
export function log(event: LogEventName, fields: LogFields = {}): void {
  const line = { ts: new Date().toISOString(), level: "info", service: "worker", event, attrs: {}, ...fields };
  if (!validate(line)) {
    throw new Error(`invalid log event: ${JSON.stringify(validate.errors)}`);
  }
  console.error(JSON.stringify(line));
}
