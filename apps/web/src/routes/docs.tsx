import {
  createFileRoute,
  Outlet,
  useChildMatches,
} from "@tanstack/react-router";

import { DocsIndexPage } from "@/features/docs/docs-pages";
import { guardFor } from "@/lib/auth/guards";

// `docs.$slug.tsx` is a child of this route (flat dotted names nest), so this
// component renders an <Outlet /> for it.
function DocsRoute() {
  const childMatches = useChildMatches();
  if (childMatches.length > 0) {
    return <Outlet />;
  }
  return <DocsIndexPage />;
}

export const Route = createFileRoute("/docs")({
  beforeLoad: guardFor("authenticated"),
  component: DocsRoute,
});
