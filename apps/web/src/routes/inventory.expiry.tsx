import { createFileRoute } from "@tanstack/react-router";

import { ExpiryPage } from "@/features/expiry/components/expiry-page";
import { guardFor } from "@/lib/auth/guards";

export const Route = createFileRoute("/inventory/expiry")({
  beforeLoad: guardFor("inventory.view"),
  component: ExpiryPage,
});
