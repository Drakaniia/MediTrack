import { Input } from "@cmis/ui/components/input";
import type { ItemSummaryDto } from "@shared/schemas/inventory";
import { useRouterState } from "@tanstack/react-router";
import { LoaderCircle, ScanLine } from "lucide-react";
import { type ReactElement, useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { useStockItemDetailDialog } from "@/features/inventory/stock-item-detail-dialog-context";
import { errorMessage } from "@/lib/api/errors";
import { formatHotkey, useHotkey } from "@/lib/hotkeys";

import { useRegisterCode } from "../hooks/use-register-code";
import { type ScanOutcome, useScanLookup } from "../hooks/use-scan-lookup";
import { useScanInput, useWedgeScanner } from "../hooks/use-wedge-scanner";
import { announcementFor } from "../lib/scan-messages";
import { type ScanFeedback, ScanFeedbackPanel } from "./scan-feedback-panel";

const FOCUS_SLASH = "/";
const FOCUS_COMBO = "mod+shift+s";
const SCAN_PAGE_PATH = "/scan";

/**
 * The scan field in the header (every page). Enter resolves the code against `GET /api/scan`:
 * a batch or item opens the stock detail dialog, several matches open a chooser, an unknown code
 * says so and (for roles that may) offers to register it. Only Enter submits, so a half-typed
 * code is never looked up. A hardware scanner also works with nothing focused (global capture);
 * the /scan page turns that off because it runs its own.
 */
export function GlobalScanField(): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const { isPending, mutateAsync } = useScanLookup();
  const { openItemDetail } = useStockItemDetailDialog();
  const register = useRegisterCode();
  const onScanPage = useRouterState({
    select: (state) => state.location.pathname === SCAN_PAGE_PATH,
  });

  const showOutcome = useCallback(
    (outcome: ScanOutcome): void => {
      setAnnouncement(announcementFor(outcome));
      if (outcome.status === "not_found") {
        setFeedback({ ...outcome, type: "not_found" });
        return;
      }
      const { result } = outcome;
      if (result.kind === "ambiguous") {
        setFeedback({ code: outcome.code, items: result.items, type: "ambiguous" });
        return;
      }
      setFeedback(null);
      if (result.kind === "batch") {
        openItemDetail(result.item.id, { batchId: result.batch.id });
        toast.success(`Found ${result.item.displayName} · ${result.batch.batchNumber}`);
        return;
      }
      openItemDetail(result.item.id);
      toast.success(`Found ${result.item.displayName}`);
    },
    [openItemDetail]
  );

  const resolve = useCallback(
    async (code: string): Promise<void> => {
      try {
        showOutcome(await mutateAsync(code));
      } catch (error) {
        setFeedback(null);
        toast.error(errorMessage(error, "Could not look up that code."));
      }
    },
    [mutateAsync, showOutcome]
  );

  const { inputProps } = useScanInput({
    onSubmit: ({ code }) => {
      setFeedback(null);
      inputRef.current?.focus();
      void resolve(code);
    },
  });

  useWedgeScanner({
    enabled: !onScanPage,
    onScan: (code) => {
      void resolve(code);
    },
  });

  const focusField = useCallback(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  useHotkey(FOCUS_SLASH, focusField);
  useHotkey(FOCUS_COMBO, focusField, { allowInInput: true });

  const dismiss = useCallback(() => {
    setFeedback(null);
    inputRef.current?.focus();
  }, []);

  const pick = useCallback(
    (item: ItemSummaryDto) => {
      setFeedback(null);
      openItemDetail(item.id);
    },
    [openItemDetail]
  );

  const hint = `${formatHotkey(FOCUS_SLASH)} or ${formatHotkey(FOCUS_COMBO)}`;

  return (
    <div className="relative w-full">
      {isPending ? (
        <LoaderCircle
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
        />
      ) : (
        <ScanLine
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
      )}
      <Input
        {...inputProps}
        aria-busy={isPending}
        aria-keyshortcuts="/ Control+Shift+S Meta+Shift+S"
        aria-label="Scan or enter code"
        autoComplete="off"
        autoCorrect="off"
        className="tap-target pl-8"
        enterKeyHint="search"
        placeholder="Scan or enter code"
        ref={inputRef}
        spellCheck={false}
        title={`Scan or enter code (${hint})`}
        type="text"
      />
      <p aria-live="polite" className="sr-only" role="status">
        {announcement}
      </p>
      {feedback ? (
        <ScanFeedbackPanel
          feedback={feedback}
          onDismiss={dismiss}
          onPick={pick}
          onRegister={register}
        />
      ) : null}
    </div>
  );
}
