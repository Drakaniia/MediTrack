import { Button, buttonVariants } from "@cmis/ui/components/button";
import { cn } from "@cmis/ui/lib/utils";
import { formatBatchCodeForDisplay } from "@shared/batch-code";
import type { BatchDto, ItemSummaryDto } from "@shared/schemas/inventory";
import type {
  ScanAction,
  ScanBatchResult,
  ScanItemResult,
} from "@shared/schemas/scan";
import { Link } from "@tanstack/react-router";
import {
  CircleCheck,
  Eye,
  OctagonAlert,
  PackageMinus,
  Plus,
  Printer,
  TriangleAlert,
} from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import { ExpiryBadge } from "@/components/expiry-badge";
import { useStockItemDetailDialog } from "@/features/inventory/stock-item-detail-dialog-context";
import { useNewRequestDialog } from "@/features/requests/new-request-dialog-context";
import { useQuickDeductDialog } from "@/features/requests/quick-deduct-dialog-context";
import { formatDate, formatQuantity } from "@/lib/format";

import { fefoNoticeFor, type FefoNotice } from "../lib/fefo-notice";

type SingleResult = ScanBatchResult | ScanItemResult;

function Fact({ label, children }: { children: ReactNode; label: string }): ReactElement {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-medium text-sm">{children}</dd>
    </div>
  );
}

function BatchFacts({ batch, item }: { batch: BatchDto; item: ItemSummaryDto }): ReactElement {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
      <Fact label="Batch number">{batch.batchNumber}</Fact>
      <Fact label="Quantity">{formatQuantity(batch.qty, item.unit)}</Fact>
      <Fact label="Expiry">
        {batch.expiry ? (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{formatDate(batch.expiry)}</span>
            <ExpiryBadge daysUntil={batch.daysUntil} expiryClass={batch.expiryClass} />
          </span>
        ) : (
          "No expiry"
        )}
      </Fact>
      <Fact label="Label code">
        <span className="font-mono">{formatBatchCodeForDisplay(batch.code)}</span>
      </Fact>
    </dl>
  );
}

const NOTICE_STYLES: Record<
  FefoNotice["tone"],
  { icon: typeof CircleCheck; tone: string }
> = {
  ok: { icon: CircleCheck, tone: "border-expiry-safe/40 bg-expiry-safe/10" },
  stop: { icon: OctagonAlert, tone: "border-expiry-expired/40 bg-expiry-expired/10" },
  warn: { icon: TriangleAlert, tone: "border-expiry-urgent/40 bg-expiry-urgent/10" },
};

function FefoHint({ notice }: { notice: FefoNotice }): ReactElement {
  const { icon: Icon, tone } = NOTICE_STYLES[notice.tone];
  return (
    <div
      className={cn("flex items-start gap-2 rounded-lg border p-3 text-sm", tone)}
      role={notice.tone === "ok" ? "status" : "alert"}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div>
        <p className="font-medium">{notice.title}</p>
        {notice.detail ? <p className="text-muted-foreground">{notice.detail}</p> : null}
      </div>
    </div>
  );
}

function labelTargetOf(result: SingleResult): string | null {
  return result.kind === "batch" ? result.batch.id : (result.fefoBatch?.id ?? null);
}

function ResultActions({ result }: { result: SingleResult }): ReactElement {
  const { openItemDetail } = useStockItemDetailDialog();
  const { openNewRequest } = useNewRequestDialog();
  const { openQuickDeduct } = useQuickDeductDialog();
  const allowed = new Set<ScanAction>(result.allowedActions);
  const labelBatchId = labelTargetOf(result);
  const batchId = result.kind === "batch" ? result.batch.id : undefined;

  return (
    <div className="flex flex-wrap gap-2">
      {allowed.has("view") ? (
        <Button
          className="tap-target"
          onClick={() => openItemDetail(result.item.id, { batchId })}
        >
          <Eye aria-hidden />
          View details
        </Button>
      ) : null}
      {allowed.has("request") ? (
        <Button
          className="tap-target"
          onClick={() => openNewRequest({ itemId: result.item.id })}
          variant="outline"
        >
          <Plus aria-hidden />
          New request for this stock
        </Button>
      ) : null}
      {allowed.has("quick_deduct") ? (
        <Button
          className="tap-target"
          onClick={() => openQuickDeduct({ itemId: result.item.id })}
          variant="outline"
        >
          <PackageMinus aria-hidden />
          Quick deduct
        </Button>
      ) : null}
      {allowed.has("label") && labelBatchId ? (
        <Link
          className={cn(buttonVariants({ variant: "outline" }), "tap-target")}
          search={{ batch: labelBatchId }}
          to="/labels"
        >
          <Printer aria-hidden />
          Print label
        </Link>
      ) : null}
    </div>
  );
}

/** What was scanned: the item, the batch (when one was named), expiry, stock and the FEFO advice. */
export function ScanResultCard({ result }: { result: SingleResult }): ReactElement {
  const { item } = result;
  const batch = result.kind === "batch" ? result.batch : result.fefoBatch;
  const notice = fefoNoticeFor(result);

  return (
    <article
      aria-label={`Scanned: ${item.displayName}`}
      className="space-y-4 rounded-xl border bg-card p-4 text-card-foreground shadow-sm"
    >
      <header>
        <p className="text-muted-foreground text-xs uppercase tracking-wide">
          {result.kind === "batch" ? "Batch scanned" : "Item scanned"}
          {item.categoryName ? ` · ${item.categoryName}` : ""}
        </p>
        <h2 className="font-semibold text-xl">{item.displayName}</h2>
        <p className="text-muted-foreground text-sm">
          {formatQuantity(item.available, item.unit)} available · {formatQuantity(item.onHand, item.unit)} on hand
        </p>
      </header>
      {batch ? <BatchFacts batch={batch} item={item} /> : null}
      {result.kind === "item" && batch ? (
        <p className="text-muted-foreground text-xs">Showing the batch to use first.</p>
      ) : null}
      <FefoHint notice={notice} />
      <ResultActions result={result} />
    </article>
  );
}
