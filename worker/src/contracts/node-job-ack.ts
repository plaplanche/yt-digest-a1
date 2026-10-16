/* Generated from contracts/node-job-ack.schema.json by scripts/contracts.sh; do not edit. */

export interface NodeJobAck {
  video_id: string;
  status: "queued" | "leased" | "done" | "failed_video";
}
