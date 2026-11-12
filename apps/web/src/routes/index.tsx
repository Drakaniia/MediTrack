import { createFileRoute } from "@tanstack/react-router";

import { DashboardPage } from "@/features/dashboard/components/dashboard-page";
import { guardFor } from "@/lib/auth/guards";

export const Route = createFileRoute("/")({
  beforeLoad: guardFor("dashboard.view"),
  component: DashboardPage,
});
