import { describe, expect, it } from "vitest";

import { HttpError } from "../http";
import { checkCsrf, isUnsafeMethod } from "./csrf";

const URL_ = "https://meditract.test/api/items";

function post(headers: Record<string, string>, url = URL_): Request {
  return new Request(url, { headers, method: "POST" });
}

function failureOf(request: Request): HttpError | null {
  try {
    checkCsrf(request);
    return null;
  } catch (error) {
    return error instanceof HttpError ? error : null;
  }
}

describe("isUnsafeMethod", () => {
  it("covers the state-changing methods only", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
      expect(isUnsafeMethod(method)).toBe(true);
    }
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(isUnsafeMethod(method)).toBe(false);
    }
  });
});

describe("checkCsrf", () => {
  it("accepts the custom header with a same-origin Origin", () => {
    expect(
      failureOf(
        post({ origin: "https://meditract.test", "x-meditract-csrf": "1" })
      )
    ).toBeNull();
  });

  it("accepts the custom header alone (non-browser clients send neither Origin nor Sec-Fetch-Site)", () => {
    expect(failureOf(post({ "x-meditract-csrf": "1" }))).toBeNull();
  });

  it("falls back to Sec-Fetch-Site when there is no Origin", () => {
    for (const site of ["same-origin", "none"]) {
      expect(
        failureOf(post({ "sec-fetch-site": site, "x-meditract-csrf": "1" }))
      ).toBeNull();
    }
    for (const site of ["cross-site", "same-site"]) {
      expect(
        failureOf(post({ "sec-fetch-site": site, "x-meditract-csrf": "1" }))
          ?.code
      ).toBe("csrf_failed");
    }
  });

  it("rejects a missing or wrong custom header", () => {
    expect(
      failureOf(post({ origin: "https://meditract.test" }))?.details
    ).toEqual({
      reason: "missing_header",
    });
    expect(
      failureOf(
        post({ origin: "https://meditract.test", "x-meditract-csrf": "0" })
      )?.code
    ).toBe("csrf_failed");
    expect(failureOf(post({ "x-meditract-csrf": "true" }))?.code).toBe(
      "csrf_failed"
    );
  });

  it("rejects a foreign, null or differently-schemed Origin", () => {
    for (const origin of [
      "https://evil.test",
      "null",
      "http://meditract.test",
      "https://meditract.test:8443",
      "https://meditract.test.evil.test",
    ]) {
      const error = failureOf(post({ origin, "x-meditract-csrf": "1" }));
      expect(error?.code).toBe("csrf_failed");
      expect(error?.status).toBe(403);
      expect(error?.details).toEqual({ reason: "origin_mismatch" });
    }
  });

  it("lets Origin win over Sec-Fetch-Site", () => {
    expect(
      failureOf(
        post({
          origin: "https://evil.test",
          "sec-fetch-site": "same-origin",
          "x-meditract-csrf": "1",
        })
      )?.code
    ).toBe("csrf_failed");
  });

  it("compares against the request's own origin (ports included)", () => {
    expect(
      failureOf(
        post(
          { origin: "http://localhost:8788", "x-meditract-csrf": "1" },
          "http://localhost:8788/api/items"
        )
      )
    ).toBeNull();
  });
});
