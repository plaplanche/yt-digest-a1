import { Ajv2020 } from "ajv/dist/2020.js";
import claimRequestSchema from "../../contracts/node-claim-request.schema.json";
import releaseRequestSchema from "../../contracts/node-release-request.schema.json";
import resultRequestSchema from "../../contracts/node-result-request.schema.json";
import transcriptResultSchema from "../../contracts/transcript-result.schema.json";
import heartbeatRequestSchema from "../../contracts/node-heartbeat-request.schema.json";
import type { NodeClaimRequest } from "./contracts/node-claim-request.js";
import type { NodeHeartbeatRequest } from "./contracts/node-heartbeat-request.js";
import type { NodeReleaseRequest } from "./contracts/node-release-request.js";
import type { NodeResultRequest } from "./contracts/node-result-request.js";

const ajv = new Ajv2020({ strict: true });
// the $ref of node-result-request is relative to the schema file name
ajv.addSchema(transcriptResultSchema, "transcript-result.schema.json");

export const validateHeartbeat = ajv.compile<NodeHeartbeatRequest>(heartbeatRequestSchema);
export const validateClaim = ajv.compile<NodeClaimRequest>(claimRequestSchema);
export const validateResult = ajv.compile<NodeResultRequest>(resultRequestSchema);
export const validateRelease = ajv.compile<NodeReleaseRequest>(releaseRequestSchema);
