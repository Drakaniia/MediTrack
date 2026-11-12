import { createFileRoute } from "@tanstack/react-router";

import { ChangePasswordPage } from "@/features/shell/components/change-password-page";
import { guardFor } from "@/lib/auth/guards";
import { redirectSearch } from "@/lib/auth/redirect";

function ChangePasswordRoute() {
  const { redirect } = Route.useSearch();
  return <ChangePasswordPage redirectTo={redirect} />;
}

export const Route = createFileRoute("/change-password")({
  // A user who MUST change their password is allowed here (and only here).
  beforeLoad: guardFor("authenticated", { allowPasswordChangePending: true }),
  component: ChangePasswordRoute,
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    redirectSearch(search.redirect),
});
