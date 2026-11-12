import { createFileRoute } from "@tanstack/react-router";

import { InventoryPage } from "@/features/inventory/components/inventory-page";
import { guardFor } from "@/lib/auth/guards";

export const Route = createFileRoute("/inventory/")({
  beforeLoad: guardFor("inventory.view"),
  component: InventoryPage,
});
