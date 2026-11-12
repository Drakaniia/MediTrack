import { QUICK_DEDUCT_UNDO_SECONDS } from "@shared/api";
import type { ItemSummaryDto } from "@shared/schemas/inventory";
import type { QuickDeductResultDto } from "@shared/schemas/requests";
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";

import { apiPost } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { invalidateStockQueries } from "@/lib/api/invalidate";
import { useCan } from "@/lib/auth/guards";
import { formatQuantity } from "@/lib/format";

import { QuickDeductDialog } from "./components/quick-deduct-dialog";
import { QuickDeductUndoToast } from "./components/quick-deduct-undo-toast";

/**
 * `QuickDeductDialogProvider` wraps the app (mounted once in the root layout);
 * `useQuickDeductDialog().openQuickDeduct()` opens the one-step deduction dialog (Ctrl+D),
 * optionally for a given item. After a successful deduction the provider shows a toast with an
 * **Undo** button that is live for the undo window (with a countdown), then disappears.
 */

export interface OpenQuickDeductOptions {
  itemId?: string;
}

export interface QuickDeductDialogApi {
  openQuickDeduct: (opts?: OpenQuickDeductOptions) => void;
}

const MS_PER_SECOND = 1000;

const QuickDeductDialogContext = createContext<QuickDeductDialogApi>({
  openQuickDeduct: () => undefined,
});

function useUndoToast(): (
  result: QuickDeductResultDto,
  item: ItemSummaryDto
) => void {
  const queryClient = useQueryClient();
  return useCallback(
    (result, item) => {
      const summary = `${formatQuantity(result.record.qty, item.unit)} of ${item.displayName}`;
      const toastId = toast.custom(
        (id) => (
          <QuickDeductUndoToast
            onExpire={() => toast.dismiss(id)}
            onUndo={async () => {
              try {
                await apiPost(`/quick-deduct/${result.record.id}/undo`);
                await invalidateStockQueries(queryClient);
                toast.dismiss(id);
                toast.success("Quick deduct undone. The stock is back.");
              } catch (error) {
                toast.error(
                  errorMessage(error, "Could not undo the deduction.")
                );
              }
            }}
            summary={summary}
          />
        ),
        { duration: QUICK_DEDUCT_UNDO_SECONDS * MS_PER_SECOND }
      );
      return toastId;
    },
    [queryClient]
  );
}

export function QuickDeductDialogProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const canDeduct = useCan("stock.quick_deduct");
  const showUndo = useUndoToast();
  const [open, setOpen] = useState<OpenQuickDeductOptions | null>(null);
  const [openCount, setOpenCount] = useState(0);

  const openQuickDeduct = useCallback(
    (opts?: OpenQuickDeductOptions) => {
      if (!canDeduct) {
        toast.error("Your role cannot use Quick Deduct.");
        return;
      }
      setOpen(opts ?? {});
      setOpenCount((count) => count + 1);
    },
    [canDeduct]
  );
  const api = useMemo(() => ({ openQuickDeduct }), [openQuickDeduct]);

  return (
    <QuickDeductDialogContext.Provider value={api}>
      {children}
      {open ? (
        <QuickDeductDialog
          initialItemId={open.itemId}
          key={openCount}
          onClose={() => setOpen(null)}
          onDone={showUndo}
        />
      ) : null}
    </QuickDeductDialogContext.Provider>
  );
}

export function useQuickDeductDialog(): QuickDeductDialogApi {
  return useContext(QuickDeductDialogContext);
}
