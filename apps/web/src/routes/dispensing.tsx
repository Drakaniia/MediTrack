import { createFileRoute } from "@tanstack/react-router";

import { DispensingPage } from "@/features/requests/components/dispensing-page";
import { guardFor } from "@/lib/auth/guards";

export const Route = createFileRoute("/dispensing")({
  beforeLoad: guardFor("dispensing.view"),
  component: DispensingPage,
});
