import { useCallback, useRef, useState } from "react";

import { errorMessage } from "@/lib/api/errors";

import { foundLabel, kindOf, type RecentKind } from "../lib/scan-messages";
import { type ScanOutcome, useScanLookup } from "./use-scan-lookup";

export const MAX_RECENT_SCANS = 10;

export interface RecentScan {
  at: string;
  code: string;
  kind: RecentKind;
  label: string;
}

export interface ScanSession {
  /** The last lookup that failed for a reason other than "not found". */
  error: string | null;
  isPending: boolean;
  outcome: ScanOutcome | null;
  /** Session-only history, newest first, at most {@link MAX_RECENT_SCANS}. */
  recent: RecentScan[];
  scan: (code: string) => Promise<void>;
}

function toRecent(outcome: ScanOutcome): RecentScan {
  return {
    at: new Date().toISOString(),
    code: outcome.code,
    kind: kindOf(outcome),
    label: foundLabel(outcome),
  };
}

/** What the /scan page shows: the latest result and a short in-memory history. */
export function useScanSession(): ScanSession {
  const { isPending, mutateAsync } = useScanLookup();
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const [recent, setRecent] = useState<RecentScan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  const scan = useCallback(
    async (code: string): Promise<void> => {
      latest.current += 1;
      const ticket = latest.current;
      setError(null);
      try {
        const next = await mutateAsync(code);
        if (ticket !== latest.current) {
          return;
        }
        setOutcome(next);
        setRecent((previous) =>
          [toRecent(next), ...previous.filter((entry) => entry.code !== next.code)].slice(
            0,
            MAX_RECENT_SCANS
          )
        );
      } catch (caught) {
        if (ticket === latest.current) {
          setError(errorMessage(caught, "Could not look up that code."));
        }
      }
    },
    [mutateAsync]
  );

  return { error, isPending, outcome, recent, scan };
}
