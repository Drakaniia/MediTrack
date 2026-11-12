import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";

import { useCan } from "@/lib/auth/guards";

import { NewRequestDialog } from "./components/new-request-dialog";

/**
 * `NewRequestDialogProvider` wraps the app (mounted once in the root layout) and
 * `useNewRequestDialog().openNewRequest()` opens the "New request" dialog, optionally pre-filled
 * with an item and quantity (item detail's "New request for this stock", the command palette).
 * The dialog itself is only mounted while open, so the layout makes no extra requests.
 */

export interface OpenNewRequestOptions {
  itemId?: string;
  qty?: number;
}

export interface NewRequestDialogApi {
  openNewRequest: (opts?: OpenNewRequestOptions) => void;
}

const NewRequestDialogContext = createContext<NewRequestDialogApi>({
  openNewRequest: () => undefined,
});

export function NewRequestDialogProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const canCreate = useCan("requests.create");
  const [open, setOpen] = useState<OpenNewRequestOptions | null>(null);
  // Re-opening while open starts a fresh form (the key changes with every open).
  const [openCount, setOpenCount] = useState(0);

  const openNewRequest = useCallback(
    (opts?: OpenNewRequestOptions) => {
      if (!canCreate) {
        toast.error("Your role cannot create requests.");
        return;
      }
      setOpen(opts ?? {});
      setOpenCount((count) => count + 1);
    },
    [canCreate]
  );
  const api = useMemo(() => ({ openNewRequest }), [openNewRequest]);

  return (
    <NewRequestDialogContext.Provider value={api}>
      {children}
      {open ? (
        <NewRequestDialog
          initial={open}
          key={openCount}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </NewRequestDialogContext.Provider>
  );
}

export function useNewRequestDialog(): NewRequestDialogApi {
  return useContext(NewRequestDialogContext);
}
