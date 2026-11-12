import { createFileRoute } from "@tanstack/react-router";

import { SettingsPage } from "@/features/admin/components/settings-page";
import { guardFor } from "@/lib/auth/guards";

export const Route = createFileRoute("/settings")({
  beforeLoad: guardFor("authenticated"),
  component: SettingsPage,
});
