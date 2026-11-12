import { afterEach, describe, expect, it, vi } from "vitest";

import { newId } from "./ids";
import { logError, logWarn } from "./log";

afterEach(() => {
  vi.restoreAllMocks();
});

function capture(method: "error" | "warn") {
  return vi.spyOn(console, method).mockImplementation(() => undefined);
}

function lineOf(spy: ReturnType<typeof capture>): Record<string, unknown> {
  expect(spy).toHaveBeenCalledTimes(1);
  return JSON.parse(String(spy.mock.calls[0][0])) as Record<string, unknown>;
}

describe("logError / logWarn", () => {
  it("writes one JSON line per call, errors to console.error and warnings to console.warn", () => {
    const error = capture("error");
    const warn = capture("warn");

    logError("Something broke", new Error("db down"), { requestId: "r-1" });
    logWarn("Something degraded", undefined, { path: "/api/x" });

    const failed = lineOf(error);
    expect(failed).toMatchObject({
      context: { requestId: "r-1" },
      error: { message: "db down", name: "Error" },
      level: "error",
      message: "Something broke",
    });
    expect(String((failed.error as { stack: string }).stack)).toContain(
      "db down"
    );
    expect(lineOf(warn)).toMatchObject({
      context: { path: "/api/x" },
      level: "warn",
      message: "Something degraded",
    });
  });

  it("includes the cause chain, a bounded number of levels deep", () => {
    const spy = capture("error");
    const root = new Error("root cause");
    logError(
      "wrapped",
      new Error("outer", { cause: new Error("inner", { cause: root }) })
    );
    const line = lineOf(spy) as {
      error: { cause: { cause: { message: string } } };
    };
    expect(line.error.cause.cause.message).toBe("root cause");
  });

  it("copes with thrown values that are not Errors", () => {
    const spy = capture("error");
    logError("odd", "just a string");
    expect(lineOf(spy)).toMatchObject({ error: { message: "just a string" } });
  });

  it("redacts sensitive keys at any depth of the context", () => {
    const spy = capture("error");
    logError("auth trouble", undefined, {
      attempt: {
        authorization: "Bearer abc",
        password: "hunter2-hunter2",
        sessionToken: "tok-123",
      },
      pbkdf2Hash: "pbkdf2-sha256$100000$s$h",
      user: "maria",
    });
    const text = String(spy.mock.calls[0][0]);
    for (const leaked of [
      "hunter2",
      "tok-123",
      "Bearer abc",
      "pbkdf2-sha256",
    ]) {
      expect(text).not.toContain(leaked);
    }
    expect(lineOf(spy)).toMatchObject({
      context: {
        attempt: {
          authorization: "[redacted]",
          password: "[redacted]",
          sessionToken: "[redacted]",
        },
        pbkdf2Hash: "[redacted]",
        user: "maria",
      },
    });
  });

  it("never throws, even for a context JSON cannot represent", () => {
    const spy = capture("error");
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => logError("circular", undefined, circular)).not.toThrow();
    expect(() => logError("bigint", undefined, { big: 10n })).not.toThrow();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(spy.mock.calls[0][0]))).toEqual({
      level: "error",
      message: "circular",
    });
  });
});

describe("newId", () => {
  it("is a v4 UUID and never repeats", () => {
    const ids = Array.from({ length: 100 }, () => newId());
    for (const id of ids) {
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );
    }
    expect(new Set(ids).size).toBe(100);
  });
});
