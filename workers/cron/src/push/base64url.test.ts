import { describe, expect, it } from "vitest";
import { base64UrlDecode, base64UrlEncode } from "./base64url";

describe("base64url", () => {
  it("encodes without padding using the URL-safe alphabet", () => {
    expect(base64UrlEncode(new Uint8Array([0xfb, 0xff, 0xfe]))).toBe("-__-");
    expect(base64UrlEncode(new Uint8Array([1]))).toBe("AQ");
    expect(base64UrlEncode(new Uint8Array([]))).toBe("");
  });

  it("round-trips every byte value", () => {
    const bytes = new Uint8Array(256).map((_, index) => index);
    expect(base64UrlDecode(base64UrlEncode(bytes))).toEqual(bytes);
  });

  it("decodes with or without padding", () => {
    expect(base64UrlDecode("AQ")).toEqual(new Uint8Array([1]));
    expect(base64UrlDecode("AQ==")).toEqual(new Uint8Array([1]));
  });

  it("rejects characters outside the alphabet", () => {
    expect(() => base64UrlDecode("a+b/")).toThrow("Invalid base64url");
    expect(() => base64UrlDecode("ab cd")).toThrow("Invalid base64url");
  });

  it("rejects impossible lengths", () => {
    expect(() => base64UrlDecode("A")).toThrow("Invalid base64url");
  });
});
