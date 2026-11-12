import { Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, BookOpen } from "lucide-react";
import type { ReactElement } from "react";

import { DataState } from "@/components/data-state";
import { PageHeader } from "@/components/page-header";

import { DOC_ARTICLES, findDoc } from "./docs-content";

const LINK_CLASS =
  "rounded-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring";

export function DocsIndexPage(): ReactElement {
  return (
    <div className="max-w-3xl">
      <PageHeader description="How MediTract works, page by page." title="Help and documentation" />
      <ul className="grid gap-2 sm:grid-cols-2">
        {DOC_ARTICLES.map((article) => (
          <li key={article.slug}>
            <Link
              className="block h-full rounded-lg border p-4 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
              params={{ slug: article.slug }}
              to="/docs/$slug"
            >
              <span className="block font-medium text-sm">{article.title}</span>
              <span className="block text-muted-foreground text-xs">{article.summary}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DocArticlePage({ slug }: { slug: string }): ReactElement {
  const article = findDoc(slug);
  const index = DOC_ARTICLES.findIndex((entry) => entry.slug === slug);
  const previous = index > 0 ? DOC_ARTICLES[index - 1] : undefined;
  const next = DOC_ARTICLES[index + 1];

  return (
    <article className="max-w-3xl text-sm">
      <Link className={`${LINK_CLASS} mb-2 inline-flex items-center gap-1 text-muted-foreground text-xs`} to="/docs">
        <ArrowLeft aria-hidden className="size-3" />
        All help topics
      </Link>
      <DataState
        empty={{
          description: "This help page does not exist. Pick a topic from the list.",
          icon: BookOpen,
          title: "Page not found",
        }}
        isEmpty={!article}
      >
        {article ? (
          <>
            <PageHeader description={article.summary} title={article.title} />
            {article.body}
            <nav aria-label="More help topics" className="mt-8 flex justify-between gap-4 border-t pt-4 text-xs">
              {previous ? (
                <Link className={`${LINK_CLASS} inline-flex items-center gap-1`} params={{ slug: previous.slug }} to="/docs/$slug">
                  <ArrowLeft aria-hidden className="size-3" />
                  {previous.title}
                </Link>
              ) : (
                <span />
              )}
              {next ? (
                <Link className={`${LINK_CLASS} inline-flex items-center gap-1`} params={{ slug: next.slug }} to="/docs/$slug">
                  {next.title}
                  <ArrowRight aria-hidden className="size-3" />
                </Link>
              ) : null}
            </nav>
          </>
        ) : null}
      </DataState>
    </article>
  );
}
