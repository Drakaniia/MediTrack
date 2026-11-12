import { useCallback, useMemo, useState } from "react";

import type { LabelBatch } from "../lib/label-layout";

export interface LabelSelection {
  /** Adds the batches not already chosen; returns how many were new. */
  addMany: (batches: readonly LabelBatch[]) => number;
  batches: LabelBatch[];
  clear: () => void;
  has: (batchId: string) => boolean;
  remove: (batchId: string) => void;
  toggle: (batch: LabelBatch) => void;
}

/** The batches chosen for printing, in the order they were added, one entry per batch. */
export function useLabelSelection(): LabelSelection {
  const [batches, setBatches] = useState<LabelBatch[]>([]);

  const addMany = useCallback(
    (incoming: readonly LabelBatch[]): number => {
      const known = new Set(batches.map((batch) => batch.id));
      const fresh = incoming.filter((batch, index) => {
        const duplicate = known.has(batch.id) || incoming.findIndex((other) => other.id === batch.id) !== index;
        return !duplicate;
      });
      if (fresh.length > 0) {
        setBatches((previous) => [...previous, ...fresh]);
      }
      return fresh.length;
    },
    [batches]
  );

  const remove = useCallback((batchId: string) => {
    setBatches((previous) => previous.filter((batch) => batch.id !== batchId));
  }, []);

  const toggle = useCallback((batch: LabelBatch) => {
    setBatches((previous) =>
      previous.some((entry) => entry.id === batch.id)
        ? previous.filter((entry) => entry.id !== batch.id)
        : [...previous, batch]
    );
  }, []);

  const clear = useCallback(() => setBatches([]), []);
  const has = useCallback(
    (batchId: string) => batches.some((batch) => batch.id === batchId),
    [batches]
  );

  return useMemo(
    () => ({ addMany, batches, clear, has, remove, toggle }),
    [addMany, batches, clear, has, remove, toggle]
  );
}
