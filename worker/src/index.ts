import pkg from "../package.json";
import { json, notFound } from "./http.js";
import { handleMcp } from "./mcp.js";
import { handleNode } from "./node.js";
import { handleOAuth } from "./oauth.js";
import { handleOps } from "./ops.js";

export default {
  async fetch(request: Request, env: Cloudflare.Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/health") return json({ status: "ok", version: pkg.version });
    if (path.startsWith("/ops/")) return handleOps(request, env, path);
    if (path.startsWith("/node/")) return handleNode(request, env, path);
    if (path === "/mcp") return handleMcp(request, env);
    const oauth = await handleOAuth(request, env, path);
    return oauth ?? notFound();
  },
} satisfies ExportedHandler<Cloudflare.Env>;
