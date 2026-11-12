import { createFileRoute } from "@tanstack/react-router";

import { AuditPage } from "@/features/admin/components/audit-page";
import { guardFor } from "@/lib/auth/guards";

export const Route = createFileRoute("/audit")({
  beforeLoad: guardFor("audit.view"),
  component: AuditPage,
});
