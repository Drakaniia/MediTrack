import { createFileRoute } from "@tanstack/react-router";

import { FefoPage } from "@/features/inventory/components/fefo-page";
import { guardFor } from "@/lib/auth/guards";

export const Route = createFileRoute("/inventory/fefo")({
  beforeLoad: guardFor("inventory.view"),
  component: FefoPage,
});
