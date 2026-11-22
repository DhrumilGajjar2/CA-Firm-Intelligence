import { ApiRequestError } from "@/lib/api-client";

/** User-facing text for any thrown value; API errors already carry the server's message. */
export function getErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  return error instanceof ApiRequestError || error instanceof Error
    ? error.message || fallback
    : fallback;
}

/** True for an API error answered with one of the given HTTP statuses. */
export const isStatus = (error: unknown, ...statuses: number[]): boolean =>
  error instanceof ApiRequestError &&
  error.status !== null &&
  statuses.includes(error.status);
