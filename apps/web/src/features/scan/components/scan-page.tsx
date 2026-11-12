import { Button } from "@cmis/ui/components/button";
import { Input } from "@cmis/ui/components/input";
import type { ItemSummaryDto } from "@shared/schemas/inventory";
import { CircleCheck, LoaderCircle, SearchX } from "lucide-react";
import {
  type ChangeEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { PageHeader } from "@/components/page-header";
import { useStockItemDetailDialog } from "@/features/inventory/stock-item-detail-dialog-context";

import { useRegisterCode } from "../hooks/use-register-code";
import type { ScanOutcome } from "../hooks/use-scan-lookup";
import { useScanSession } from "../hooks/use-scan-session";
import { useScanInput, useWedgeScanner } from "../hooks/use-wedge-scanner";
import { announcementFor } from "../lib/scan-messages";
import { RecentScans } from "./recent-scans";
import { ScanResultCard } from "./scan-result-card";

const HANDHELD_STORAGE_KEY = "meditract.scan.handheld";

function readHandheldPreference(): boolean {
  try {
    return localStorage.getItem(HANDHELD_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeHandheldPreference(on: boolean): void {
  try {
    localStorage.setItem(HANDHELD_STORAGE_KEY, on ? "1" : "0");
  } catch {
    // Storage can be blocked (private mode); the toggle still works for this visit.
  }
}

function NotFoundCard({
  canRegister,
  code,
  onRegister,
}: {
  canRegister: boolean;
  code: string;
  onRegister: (code: string) => void;
}): ReactElement {
  return (
    <article
      aria-label="Code not found"
      className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4"
    >
      <SearchX aria-hidden className="mt-0.5 size-5 shrink-0 text-destructive" />
      <div className="min-w-0 space-y-2">
        <div>
          <h2 className="font-semibold text-base">Code not found</h2>
          <p className="break-all font-mono text-muted-foreground text-sm">{code}</p>
          <p className="text-muted-foreground text-sm">
            No item or batch in stock uses this code.
          </p>
        </div>
        {canRegister ? (
          <Button className="tap-target" onClick={() => onRegister(code)} variant="outline">
            Register this code
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function AmbiguousCard({
  code,
  items,
  onPick,
}: {
  code: string;
  items: ItemSummaryDto[];
  onPick: (item: ItemSummaryDto) => void;
}): ReactElement {
  return (
    <article aria-label="Several items match" className="space-y-3 rounded-xl border p-4">
      <div>
        <h2 className="font-semibold text-base">Several items match this code</h2>
        <p className="break-all font-mono text-muted-foreground text-sm">{code}</p>
      </div>
      <ul aria-label="Matching items" className="divide-y rounded-lg border">
        {items.map((item) => (
          <li key={item.id}>
            <Button
              className="tap-target h-auto w-full justify-start rounded-none py-2 text-left"
              onClick={() => onPick(item)}
              variant="ghost"
            >
              {item.displayName}
            </Button>
          </li>
        ))}
      </ul>
    </article>
  );
}

function ResultPanel({
  onPick,
  onRegister,
  outcome,
}: {
  onPick: (item: ItemSummaryDto) => void;
  onRegister: (code: string) => void;
  outcome: ScanOutcome | null;
}): ReactElement {
  if (!outcome) {
    return (
      <p className="rounded-xl border border-dashed p-6 text-center text-muted-foreground text-sm">
        Scan a QR label or barcode, or type a code and press Enter. The result appears here.
      </p>
    );
  }
  if (outcome.status === "not_found") {
    return (
      <NotFoundCard
        canRegister={outcome.canRegister}
        code={outcome.code}
        onRegister={onRegister}
      />
    );
  }
  const { result } = outcome;
  if (result.kind === "ambiguous") {
    return <AmbiguousCard code={outcome.code} items={result.items} onPick={onPick} />;
  }
  return <ScanResultCard result={result} />;
}

function ScannerStatus({ pending }: { pending: boolean }): ReactElement {
  const Icon = pending ? LoaderCircle : CircleCheck;
  return (
    <p className="flex items-center gap-2 text-sm" role="status">
      <Icon
        aria-hidden
        className={pending ? "size-4 animate-spin" : "size-4 text-expiry-safe"}
      />
      <span className="font-medium">{pending ? "Looking up…" : "Scanner ready"}</span>
      {pending ? null : (
        <span className="text-muted-foreground">Scan with a handheld scanner or type a code.</span>
      )}
    </p>
  );
}

/**
 * The /scan page: a large scan field that keeps focus for a handheld scanner, the last result
 * with the FEFO advice and the actions this role may take, and this session's recent scans.
 */
export function ScanPage(): ReactElement {
  const inputId = useId();
  const handheldId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const session = useScanSession();
  const { openItemDetail } = useStockItemDetailDialog();
  const register = useRegisterCode();
  const [handheld, setHandheld] = useState(readHandheldPreference);
  const [announcement, setAnnouncement] = useState("");
  const { scan } = session;

  const lookUp = useCallback(
    async (code: string): Promise<void> => {
      await scan(code);
      inputRef.current?.focus();
    },
    [scan]
  );

  const { inputProps, submit } = useScanInput({
    onSubmit: ({ code }) => {
      void lookUp(code);
    },
  });
  useWedgeScanner({
    onScan: (code) => {
      void lookUp(code);
    },
  });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setAnnouncement(session.outcome ? announcementFor(session.outcome) : "");
  }, [session.outcome]);

  const toggleHandheld = (event: ChangeEvent<HTMLInputElement>): void => {
    setHandheld(event.target.checked);
    writeHandheldPreference(event.target.checked);
    inputRef.current?.focus();
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeader
        description="Scan a QR label or barcode to see the batch, its expiry and what to use first."
        title="Scan"
      />
      <div className="space-y-3">
        <ScannerStatus pending={session.isPending} />
        <div className="space-y-2">
          <label className="font-medium text-sm" htmlFor={inputId}>
            Scan or enter a code
          </label>
          <div className="flex gap-2">
            <Input
              {...inputProps}
              autoComplete="off"
              autoCorrect="off"
              className="h-14 text-lg md:text-lg"
              enterKeyHint="search"
              id={inputId}
              inputMode={handheld ? "none" : "text"}
              ref={inputRef}
              spellCheck={false}
              type="text"
            />
            <Button className="h-14 px-5" onClick={submit} size="lg" type="button">
              Look up
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <input
            checked={handheld}
            className="size-4 accent-primary"
            id={handheldId}
            onChange={toggleHandheld}
            type="checkbox"
          />
          <label htmlFor={handheldId}>
            Handheld scanner mode: keep the on-screen keyboard closed
          </label>
        </div>
      </div>
      <p aria-live="polite" className="sr-only" role="status">
        {announcement}
      </p>
      {session.error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm" role="alert">
          {session.error}
        </p>
      ) : null}
      <section aria-label="Last scan result">
        <ResultPanel
          onPick={(item) => openItemDetail(item.id)}
          onRegister={register}
          outcome={session.outcome}
        />
      </section>
      <RecentScans onSelect={(code) => void lookUp(code)} scans={session.recent} />
    </div>
  );
}
