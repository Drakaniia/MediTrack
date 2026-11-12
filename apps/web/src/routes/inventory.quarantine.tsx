import { createFileRoute } from "@tanstack/react-router";

import { QuarantinePage } from "@/features/expiry/components/quarantine-page";
import { guardFor } from "@/lib/auth/guards";

export const Route = createFileRoute("/inventory/quarantine")({
  beforeLoad: guardFor("inventory.view"),
  component: QuarantinePage,
});
