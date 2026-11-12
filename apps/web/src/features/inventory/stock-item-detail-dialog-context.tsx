import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from "react";

import { StockItemDetailDialog } from "./components/stock-item-detail-dialog";

/**
 * `StockItemDetailDialogProvider` wraps the app (mounted once in the root layout);
 * `useStockItemDetailDialog().openItemDetail(itemId)` opens the item detail dialog from
 * anywhere (scan result, palette, request board…), optionally highlighting one batch.
 */

export interface OpenItemDetailOptions {
  batchId?: string;
}

export interface StockItemDetailDialogApi {
  openItemDetail: (itemId: string, opts?: OpenItemDetailOptions) => void;
}

interface OpenTarget {
  batchId?: string;
  itemId: string;
}

const NOOP_API: StockItemDetailDialogApi = {
  openItemDetail: () => undefined,
};

const StockItemDetailDialogContext =
  createContext<StockItemDetailDialogApi>(NOOP_API);

export function StockItemDetailDialogProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const [target, setTarget] = useState<OpenTarget | null>(null);
  const api = useMemo<StockItemDetailDialogApi>(
    () => ({
      openItemDetail: (itemId, opts) =>
        setTarget({ batchId: opts?.batchId, itemId }),
    }),
    []
  );
  return (
    <StockItemDetailDialogContext.Provider value={api}>
      {children}
      {target ? (
        <StockItemDetailDialog
          batchId={target.batchId}
          itemId={target.itemId}
          onClose={() => setTarget(null)}
        />
      ) : null}
    </StockItemDetailDialogContext.Provider>
  );
}

export function useStockItemDetailDialog(): StockItemDetailDialogApi {
  return useContext(StockItemDetailDialogContext);
}
