import { createFileRoute } from "@tanstack/react-router";

import { ScanPage } from "@/features/scan/components/scan-page";
import { guardFor } from "@/lib/auth/guards";

export const Route = createFileRoute("/scan")({
  beforeLoad: guardFor("scan.use"),
  component: ScanPage,
});
