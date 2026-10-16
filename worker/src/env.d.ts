declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    TRANSCRIPTS: R2Bucket;
    OPS_TOKEN?: string;
  }
}
