import { createFileRoute } from "@tanstack/react-router";

import { DocArticlePage } from "@/features/docs/docs-pages";
import { guardFor } from "@/lib/auth/guards";

function DocsArticleRoute() {
  const { slug } = Route.useParams();
  return <DocArticlePage slug={slug} />;
}

export const Route = createFileRoute("/docs/$slug")({
  beforeLoad: guardFor("authenticated"),
  component: DocsArticleRoute,
});
