import { Ajv2020 } from "ajv/dist/2020.js";
import claimRequestSchema from "../../contracts/node-claim-request.schema.json";
import heartbeatRequestSchema from "../../contracts/node-heartbeat-request.schema.json";
import type { NodeClaimRequest } from "./contracts/node-claim-request.js";
import type { NodeHeartbeatRequest } from "./contracts/node-heartbeat-request.js";

const ajv = new Ajv2020({ strict: true });

export const validateHeartbeat = ajv.compile<NodeHeartbeatRequest>(heartbeatRequestSchema);
export const validateClaim = ajv.compile<NodeClaimRequest>(claimRequestSchema);
