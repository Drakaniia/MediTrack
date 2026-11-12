import { createFileRoute } from "@tanstack/react-router";

import { LowStockPage } from "@/features/expiry/components/low-stock-page";
import { guardFor } from "@/lib/auth/guards";

export const Route = createFileRoute("/inventory/low-stock")({
  beforeLoad: guardFor("inventory.view"),
  component: LowStockPage,
});
