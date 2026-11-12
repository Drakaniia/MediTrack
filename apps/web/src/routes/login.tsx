import { createFileRoute } from "@tanstack/react-router";

import { LoginPage } from "@/features/shell/components/login-page";
import { redirectIfSignedIn } from "@/lib/auth/guards";
import { redirectSearch } from "@/lib/auth/redirect";

function LoginRoute() {
  const { redirect } = Route.useSearch();
  return <LoginPage redirectTo={redirect} />;
}

export const Route = createFileRoute("/login")({
  beforeLoad: ({ context }) => redirectIfSignedIn(context),
  component: LoginRoute,
  // `?redirect=` comes from the URL: only an in-app path survives.
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    redirectSearch(search.redirect),
});
