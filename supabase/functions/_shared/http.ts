import type { z } from "zod";

/** An error with an HTTP status and a stable code the web app can switch on. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string, code = "bad_request") => new HttpError(400, code, message);
export const unauthorized = (message = "sign in again") => new HttpError(401, "unauthorized", message);
export const forbidden = (message: string, code = "forbidden") => new HttpError(403, code, message);
export const notFound = (message = "not found") => new HttpError(404, "not_found", message);
export const conflict = (message: string, code = "conflict") => new HttpError(409, code, message);

/** JSON with bigints written as decimal strings, so amounts stay exact. */
export function json(body: unknown, init: ResponseInit = {}): Response {
  const text = JSON.stringify(body, (_key, value) => (typeof value === "bigint" ? value.toString() : value));
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(text, { ...init, headers });
}

export async function readJson<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw badRequest("body must be JSON");
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw badRequest(issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "invalid body");
  }
  return result.data;
}

/** Like `readJson`, but an empty body counts as `{}`. */
export async function readOptionalJson<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  const text = await req.text();
  let body: unknown = {};
  if (text.trim() !== "") {
    try {
      body = JSON.parse(text);
    } catch {
      throw badRequest("body must be JSON");
    }
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw badRequest(issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "invalid body");
  }
  return result.data;
}

export function methodNotAllowed(allowed: readonly string[]): HttpError {
  return new HttpError(405, "method_not_allowed", `use ${allowed.join(" or ")}`);
}

export type Handler = (req: Request) => Promise<Response>;

export type ServeOptions = {
  /** The web app's origin (`APP_BASE_URL`). Browsers from any other origin get no CORS headers. */
  allowedOrigin?: string;
  /** Extra request headers to allow in CORS preflight. */
  allowHeaders?: string[];
};

function corsHeaders(req: Request, options: ServeOptions): Headers {
  const headers = new Headers();
  const origin = req.headers.get("origin");
  const allowed = options.allowedOrigin ? new URL(options.allowedOrigin).origin : null;
  if (origin && allowed && origin === allowed) {
    headers.set("access-control-allow-origin", origin);
    headers.set("vary", "origin");
    headers.set("access-control-allow-headers", ["authorization", "content-type", "apikey", "x-client-info", ...(options.allowHeaders ?? [])].join(", "));
    headers.set("access-control-allow-methods", "GET, POST, PATCH, OPTIONS");
    headers.set("access-control-max-age", "600");
  }
  return headers;
}

/**
 * Wraps a handler: answers CORS preflight, turns `HttpError` into its status, and hides every other error behind a
 * 500 so stack traces and secrets never reach the browser.
 */
export function withErrors(handler: Handler, options: ServeOptions = {}): Handler {
  return async (req) => {
    const cors = corsHeaders(req, options);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    let response: Response;
    try {
      response = await handler(req);
    } catch (error) {
      if (error instanceof HttpError) {
        response = json({ error: { code: error.code, message: error.message } }, { status: error.status });
      } else {
        console.error(error);
        response = json({ error: { code: "internal", message: "something went wrong" } }, { status: 500 });
      }
    }
    const headers = new Headers(response.headers);
    cors.forEach((value, key) => headers.set(key, value));
    return new Response(response.body, { status: response.status, headers });
  };
}
