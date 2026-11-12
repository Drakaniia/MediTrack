import { createFileRoute } from "@tanstack/react-router";

import { AddStockPage } from "@/features/inventory/components/add-stock/add-stock-page";
import { guardFor } from "@/lib/auth/guards";

interface AddStockSearch {
  itemId?: string;
}

function AddStockRoute() {
  const { itemId } = Route.useSearch();
  return <AddStockPage initialItemId={itemId} />;
}

export const Route = createFileRoute("/inventory/add")({
  beforeLoad: guardFor("inventory.write"),
  component: AddStockRoute,
  validateSearch: (search: Record<string, unknown>): AddStockSearch => ({
    itemId: typeof search.itemId === "string" ? search.itemId : undefined,
  }),
});
