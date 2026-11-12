import { createFileRoute } from "@tanstack/react-router";

import { NotificationsPage } from "@/features/alerts/components/notifications-page";
import { guardFor } from "@/lib/auth/guards";

export const Route = createFileRoute("/notifications")({
  beforeLoad: guardFor("alerts.view"),
  component: NotificationsPage,
});
