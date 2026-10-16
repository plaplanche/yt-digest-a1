import type { ErrorBody } from "./contracts/error.js";

/** A JSON response with the `Content-Type` of section 6.1. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** An error response with the body of section 4.2. */
export function errorResponse(status: number, code: string, message: string): Response {
  const body: ErrorBody = { error: { code, message } };
  return json(body, status);
}

export const notFound = (): Response => errorResponse(404, "not_found", "Not found");
