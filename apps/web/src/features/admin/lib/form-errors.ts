import { errorMessage, fieldErrors, isApiError } from "@/lib/api/errors";

export interface ServerFormErrors {
  /** Messages by field name (the last segment-joined path, e.g. `facility.name`). */
  fields: Record<string, string>;
  /** A message that belongs to the whole form. */
  form?: string;
}

function conflictField(error: unknown): string | undefined {
  if (
    isApiError(error) &&
    error.code === "conflict" &&
    typeof error.details === "object" &&
    error.details !== null &&
    "field" in error.details &&
    typeof error.details.field === "string"
  ) {
    return error.details.field;
  }
  return undefined;
}

/**
 * Sorts a failed request into per-field messages and one form-level message:
 * `validation_error` issues land on their field (an issue with no path is
 * form-level); a `conflict` that names a field (`{ field: "username" }`) lands
 * on it; everything else is form-level, in the server's own words.
 */
export function serverFormErrors(
  error: unknown,
  fallback: string
): ServerFormErrors {
  const { "": formLevel, ...fields } = fieldErrors(error);
  if (Object.keys(fields).length > 0 || formLevel) {
    return { fields, form: formLevel };
  }
  const field = conflictField(error);
  if (field && isApiError(error)) {
    return { fields: { [field]: error.message } };
  }
  return { fields: {}, form: errorMessage(error, fallback) };
}
