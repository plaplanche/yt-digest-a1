import pkg from "../package.json";
import { errorResponse, json } from "./http.js";
import { log } from "./log.js";
import { checkAccessToken } from "./token.js";

const PROTOCOL_VERSION = "2025-06-18";
const TOOL = "list_subscriptions";

type Id = string | number | null;

const rpcResult = (id: Id, result: unknown): Response => json({ jsonrpc: "2.0", id, result });
const rpcError = (id: Id, code: number, message: string): Response => json({ jsonrpc: "2.0", id, error: { code, message } });

function unauthorized(env: Cloudflare.Env, reason: string): Response {
  const base = env.PUBLIC_URL.replace(/\/+$/, "");
  const res = json({ error: "invalid_token", error_description: `Access token ${reason}` }, 401);
  res.headers.set("WWW-Authenticate", `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`);
  return res;
}

/** Section 11.2: true when the request has no `Origin` or an allowed one. */
function originAllowed(request: Request, env: Cloudflare.Env): boolean {
  const origin = request.headers.get("Origin");
  if (origin === null) return true;
  const allowed = [new URL(env.PUBLIC_URL).origin, ...(env.ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter((o) => o !== "")];
  return allowed.includes(origin);
}

function callTool(id: Id, params: unknown): Response {
  const started = Date.now();
  const name = typeof params === "object" && params !== null ? (params as { name?: unknown }).name : undefined;
  const ok = name === TOOL;
  log("mcp.tool.call", { attrs: { tool: typeof name === "string" ? name : "", outcome: ok ? "ok" : "error", duration_ms: Date.now() - started } });
  if (!ok) return rpcError(id, -32602, "Unknown tool");
  return rpcResult(id, { content: [{ type: "text", text: JSON.stringify({ subscriptions: [] }) }], isError: false });
}

/** `POST /mcp` (section 11). */
export async function handleMcp(request: Request, env: Cloudflare.Env): Promise<Response> {
  if (!originAllowed(request, env)) {
    log("auth.origin.rejected", { level: "warn", attrs: { origin: request.headers.get("Origin") ?? "" } });
    return errorResponse(403, "origin_rejected", "Origin not allowed");
  }
  const bearer = /^Bearer (.+)$/.exec(request.headers.get("Authorization") ?? "")?.[1] ?? null;
  const grant = await checkAccessToken(env, bearer);
  if ("reason" in grant) {
    log("auth.bearer.rejected", { level: "warn", attrs: { surface: "mcp", reason: grant.reason } });
    return unauthorized(env, grant.reason);
  }
  if (request.method !== "POST") return errorResponse(404, "not_found", "Not found");

  let message: unknown;
  try {
    message = await request.json();
  } catch {
    return errorResponse(400, "invalid_request", "The body must be JSON");
  }
  if (typeof message !== "object" || message === null || Array.isArray(message)) return errorResponse(400, "invalid_request", "The body must be a JSON-RPC message");
  const { id, method, params } = message as { id?: unknown; method?: unknown; params?: unknown };
  if (typeof method !== "string") return errorResponse(400, "invalid_request", "A JSON-RPC request needs a method");
  if (id === undefined) return new Response(null, { status: 202 });
  if (id !== null && typeof id !== "string" && typeof id !== "number") return errorResponse(400, "invalid_request", "Invalid id");

  switch (method) {
    case "initialize":
      return rpcResult(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: "yt-digest", version: pkg.version } });
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: [{ name: TOOL, description: "Lists the subscriptions of the user.", inputSchema: { type: "object", properties: {} } }] });
    case "tools/call":
      return callTool(id, params);
    default:
      return rpcError(id, -32601, "Method not found");
  }
}
