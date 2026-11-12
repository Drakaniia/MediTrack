import { describe, expect, it } from "vitest";

import {
  base64UrlDecode,
  base64UrlEncode,
  randomToken,
  sha256Hex,
  timingSafeEqual,
  timingSafeEqualBytes,
} from "./crypto";

describe("base64url", () => {
  it("uses the URL-safe alphabet without padding", () => {
    expect(base64UrlEncode(new Uint8Array([251, 255, 191]))).toBe("-_-_");
    expect(base64UrlEncode(new Uint8Array([1]))).toBe("AQ");
    expect(base64UrlEncode(new Uint8Array([]))).toBe("");
  });

  it("round-trips every length from 0 to 40 bytes", () => {
    for (let length = 0; length <= 40; length += 1) {
      const bytes = crypto.getRandomValues(new Uint8Array(length));
      const encoded = base64UrlEncode(bytes);
      expect(encoded).toMatch(/^[A-Za-z0-9_-]*$/);
      const decoded = base64UrlDecode(encoded);
      expect(decoded).not.toBeNull();
      expect([...(decoded ?? [])]).toEqual([...bytes]);
    }
  });

  it("accepts padded input", () => {
    expect([...(base64UrlDecode("AQ==") ?? [])]).toEqual([1]);
  });

  it("returns null for text that is not base64url", () => {
    for (const bad of ["a", "abcde", "ab+d", "ab/d", "ab d", "a=b=", "é"]) {
      expect(base64UrlDecode(bad)).toBeNull();
    }
  });
});

describe("sha256Hex", () => {
  it("matches the published test vectors", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });
});

describe("randomToken", () => {
  it("is 32 bytes (43 characters) of base64url by default", () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken(16)).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("never repeats", () => {
    const seen = new Set(Array.from({ length: 200 }, () => randomToken()));
    expect(seen.size).toBe(200);
  });
});

describe("timingSafeEqual", () => {
  it("is true only for identical strings", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("", "")).toBe(true);
    expect(timingSafeEqual("héllo", "héllo")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
    expect(timingSafeEqual("abcd", "abc")).toBe(false);
    expect(timingSafeEqual("", "a")).toBe(false);
    expect(timingSafeEqual("héllo", "hello")).toBe(false);
  });

  it("compares raw bytes too", () => {
    expect(
      timingSafeEqualBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2]))
    ).toBe(true);
    expect(
      timingSafeEqualBytes(new Uint8Array([1, 2]), new Uint8Array([1, 3]))
    ).toBe(false);
    expect(
      timingSafeEqualBytes(new Uint8Array([1]), new Uint8Array([1, 0]))
    ).toBe(false);
  });
});
