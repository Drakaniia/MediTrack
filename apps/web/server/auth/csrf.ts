/**
 * CSRF defence for state-changing requests (spec §8.4), on top of `SameSite=Lax`.
 *
 *  1. The custom header `x-meditract-csrf: 1` is REQUIRED. A cross-site form or
 *     `<img>` cannot set it, and a cross-origin `fetch` that does is subject to CORS
 *     preflight, which this API never grants.
 *  2. If the browser sent `Origin`, it must be exactly this request's origin.
 *  3. Otherwise `Sec-Fetch-Site` must say `same-origin` (or `none`: user-initiated).
 *  4. With neither header (curl, scripts, server-to-server) the custom header alone is
 *     accepted — those clients have no ambient cookies to ride on.
 */

import { CSRF_HEADER, CSRF_HEADER_VALUE } from "../../shared/api";
import { HttpError } from "../http";

const UNSAFE_METHODS: ReadonlySet<string> = new Set([
  "DELETE",
  "PATCH",
  "POST",
  "PUT",
]);
const SAME_SITE_FETCH_SITES: ReadonlySet<string> = new Set([
  "none",
  "same-origin",
]);

/** Methods that change state and therefore need the CSRF check. */
export function isUnsafeMethod(method: string): boolean {
  return UNSAFE_METHODS.has(method.toUpperCase());
}

function csrfFailure(reason: string): HttpError {
  return new HttpError(
    "csrf_failed",
    "The request could not be verified. Reload the page and try again.",
    { reason }
  );
}

/** Throws `HttpError("csrf_failed")` unless the request passes. Call it for unsafe methods only. */
export function checkCsrf(request: Request): void {
  if (request.headers.get(CSRF_HEADER) !== CSRF_HEADER_VALUE) {
    throw csrfFailure("missing_header");
  }
  const origin = request.headers.get("origin");
  if (origin !== null) {
    if (origin !== new URL(request.url).origin) {
      throw csrfFailure("origin_mismatch");
    }
    return;
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && !SAME_SITE_FETCH_SITES.has(fetchSite)) {
    throw csrfFailure("cross_site");
  }
}
