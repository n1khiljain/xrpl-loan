import { PUBLIC_ENV } from "./env";

/** An edge function error, with the stable `code` the function sent and a message to show. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type CallOptions = {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  query?: Record<string, string>;
  token?: string | null;
};

/** Calls `supabase/functions/<name>` with the caller's Privy token. The browser never holds a service key. */
export async function callFunction<T>(name: string, options: CallOptions = {}): Promise<T> {
  const url = new URL(`${PUBLIC_ENV.supabaseUrl}/functions/v1/${name}`);
  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (PUBLIC_ENV.supabaseAnonKey) headers.apikey = PUBLIC_ENV.supabaseAnonKey;
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, "network", "We couldn't reach the server. Check your connection and try again.");
  }
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : {};
  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string } }).error;
    throw new ApiError(response.status, error?.code ?? "error", friendlyApiMessage(response.status, error?.message));
  }
  return payload as T;
}

function friendlyApiMessage(status: number, message: string | undefined): string {
  if (status === 401) return "Your session ended. Sign in again.";
  if (status >= 500) return "Something went wrong on our side. Try again in a minute.";
  if (!message) return "That didn't work. Try again.";
  return message.charAt(0).toUpperCase() + message.slice(1) + (/[.!?]$/.test(message) ? "" : ".");
}

/** Uploads a receipt to the one-time signed target `documents` returned (FR-B3). */
export async function uploadToSignedUrl(path: string, token: string, file: Blob): Promise<void> {
  const url = new URL(`${PUBLIC_ENV.supabaseUrl}/storage/v1/object/upload/sign/receipts/${path}`);
  url.searchParams.set("token", token);
  const form = new FormData();
  form.append("cacheControl", "3600");
  form.append("", file);
  const headers: Record<string, string> = { "x-upsert": "false" };
  if (PUBLIC_ENV.supabaseAnonKey) {
    headers.apikey = PUBLIC_ENV.supabaseAnonKey;
    headers.authorization = `Bearer ${PUBLIC_ENV.supabaseAnonKey}`;
  }
  const response = await fetch(url, { method: "PUT", body: form, headers });
  if (!response.ok) throw new ApiError(response.status, "upload_failed", "The upload didn't go through. Try that file again.");
}

/** Turns a relative signed path from `documents-read` into a full URL. */
export function storageUrl(signedPath: string): string {
  return `${PUBLIC_ENV.supabaseUrl}${signedPath}`;
}
