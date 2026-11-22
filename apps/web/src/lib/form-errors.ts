import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { ApiRequestError } from "@/lib/api-client";

/**
 * Maps `ApiRequestError.errors[].field` onto form fields (e.g. 409 on `email`).
 * Returns the message for a non-field alert, or null when every error landed on a field.
 */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): string | null {
  if (!(error instanceof ApiRequestError)) {
    return "Something went wrong. Please try again.";
  }

  const known = new Set<string>(fields);
  const unmapped: string[] = [];
  let mapped = 0;

  for (const detail of error.errors) {
    if (detail.field && known.has(detail.field)) {
      setError(
        detail.field as Path<T>,
        {
          type: "server",
          message: detail.message,
        },
        { shouldFocus: mapped === 0 },
      );
      mapped += 1;
    } else {
      unmapped.push(detail.message);
    }
  }

  if (mapped === 0) return error.message;
  return unmapped.length > 0 ? unmapped.join(" ") : null;
}
