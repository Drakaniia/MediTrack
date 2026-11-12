import type { ScanNotFoundDetails, ScanResult } from "@shared/schemas/scan";
import { useMutation, type UseMutationResult } from "@tanstack/react-query";

import { apiGet } from "@/lib/api/client";
import { isApiError, isRecord } from "@/lib/api/errors";

/**
 * `GET /api/scan?code=`. A lookup is a mutation, not a cached query: stock figures on the
 * result card must be what the server says right now, and every scan is a fresh event.
 */

export type ScanOutcome =
  | { code: string; result: ScanResult; status: "found" }
  | { canRegister: boolean; code: string; status: "not_found" };

function readNotFound(details: unknown, typed: string): ScanNotFoundDetails {
  if (!isRecord(details)) {
    return { canRegister: false, code: typed };
  }
  return {
    canRegister: details.canRegister === true,
    code: typeof details.code === "string" ? details.code : typed,
  };
}

/** Resolves a code; a 404 `scan_not_found` is an outcome, every other failure throws. */
export async function lookupCode(code: string): Promise<ScanOutcome> {
  try {
    const result = await apiGet<ScanResult>("/scan", { code });
    return { code, result, status: "found" };
  } catch (error) {
    if (isApiError(error) && error.code === "scan_not_found") {
      const details = readNotFound(error.details, code);
      return { ...details, status: "not_found" };
    }
    throw error;
  }
}

export function useScanLookup(): UseMutationResult<ScanOutcome, Error, string> {
  return useMutation({ mutationFn: lookupCode });
}
