import type { PagesContext } from "../server/env";
import { errorResponse, HttpError } from "../server/http";
import { logError } from "../server/log";

/** What Pages hands a middleware: the usual context plus `next()` for the rest of the chain. */
export interface PagesMiddlewareContext extends PagesContext {
  next: () => Promise<Response>;
}

function isApiRequest(request: Request): boolean {
  const { pathname } = new URL(request.url);
  return pathname === "/api" || pathname.startsWith("/api/");
}

function noStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

/**
 * Safety net for `/api/*`: `handleApi` already turns every failure into JSON, but if
 * anything escapes (a bundling fault, a bad binding) the caller must still get a JSON 500,
 * never Cloudflare's HTML error page. API responses are never cached. Static assets pass
 * straight through.
 */
export const onRequest = async (
  context: PagesMiddlewareContext
): Promise<Response> => {
  if (!isApiRequest(context.request)) {
    return await context.next();
  }
  try {
    return noStore(await context.next());
  } catch (error) {
    logError("Unhandled error escaped the API", error, {
      path: new URL(context.request.url).pathname,
    });
    return noStore(
      errorResponse(
        new HttpError(
          "internal_error",
          "Something went wrong on our side. Please try again."
        )
      )
    );
  }
};
