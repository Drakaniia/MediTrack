import { createFileRoute } from "@tanstack/react-router";

import { LabelsPage } from "@/features/scan/components/labels-page";
import { guardFor } from "@/lib/auth/guards";

interface LabelsSearch {
  batch?: string;
}

function LabelsRoute() {
  const { batch } = Route.useSearch();
  return <LabelsPage initialBatchId={batch} />;
}

export const Route = createFileRoute("/labels")({
  beforeLoad: guardFor("inventory.write"),
  component: LabelsRoute,
  validateSearch: (search: Record<string, unknown>): LabelsSearch => ({
    batch: typeof search.batch === "string" && search.batch !== "" ? search.batch : undefined,
  }),
});
