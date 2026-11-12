import { createFileRoute } from "@tanstack/react-router";

import { TrashPage } from "@/features/inventory/components/trash-page";
import { guardFor } from "@/lib/auth/guards";

export const Route = createFileRoute("/trash")({
  beforeLoad: guardFor("trash.manage"),
  component: TrashPage,
});
