/* Generated from contracts/node-result-request.schema.json by scripts/contracts.sh; do not edit. */

import type {TranscriptResult} from "./transcript-result.js";

export interface NodeResultRequest {
  lease_id: string;
  outcome: "ok" | "no_transcript" | "unavailable" | "blocked" | "error";
  transcript: TranscriptResult | null;
}
