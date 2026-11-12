import { createFileRoute } from "@tanstack/react-router";

import { AnalyticsPage } from "@/features/analytics/components/analytics-page";
import { guardFor } from "@/lib/auth/guards";

export const Route = createFileRoute("/analytics")({
  beforeLoad: guardFor("analytics.view"),
  component: AnalyticsPage,
});
