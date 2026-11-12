import { createFileRoute } from "@tanstack/react-router";

import { RequestsPage } from "@/features/requests/components/requests-page";
import { guardFor } from "@/lib/auth/guards";

export const Route = createFileRoute("/requests")({
  beforeLoad: guardFor("requests.view"),
  component: RequestsPage,
});
