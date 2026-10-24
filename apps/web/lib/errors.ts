import { ApiError } from "./api";

/** What went wrong, in words that say what to do next. Edge functions already send readable messages. */
export function friendlyError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "That didn't work. Try again.";
}
