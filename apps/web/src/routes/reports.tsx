import { createFileRoute } from "@tanstack/react-router";

import { ReportsPage } from "@/features/reports/components/reports-page";
import { guardFor } from "@/lib/auth/guards";

export const Route = createFileRoute("/reports")({
  beforeLoad: guardFor("reports.view"),
  component: ReportsPage,
});
