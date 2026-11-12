import { MAX_DIGEST_RECIPIENTS } from "@shared/settings";
import { describe, expect, it } from "vitest";

import { addRecipient, removeRecipient } from "./recipients";

describe("addRecipient", () => {
  it("adds a trimmed, lower-cased address", () => {
    expect(addRecipient(["a@x.org"], "  B@X.org ")).toEqual({
      ok: true,
      recipients: ["a@x.org", "b@x.org"],
    });
  });

  it("rejects blank, malformed and duplicate addresses", () => {
    expect(addRecipient([], "  ")).toMatchObject({ ok: false });
    expect(addRecipient([], "nope")).toEqual({
      message: "Enter a valid email address.",
      ok: false,
    });
    expect(addRecipient(["a@x.org"], "A@x.org")).toEqual({
      message: "That address is already on the list.",
      ok: false,
    });
  });

  it("stops at the maximum", () => {
    const full = Array.from(
      { length: MAX_DIGEST_RECIPIENTS },
      (_, index) => `u${index}@x.org`
    );
    expect(addRecipient(full, "new@x.org")).toEqual({
      message: `You can add up to ${MAX_DIGEST_RECIPIENTS} recipients.`,
      ok: false,
    });
    expect(addRecipient(full.slice(1), "new@x.org")).toMatchObject({
      ok: true,
    });
  });

  it("removes by address", () => {
    expect(removeRecipient(["a@x.org", "b@x.org"], "a@x.org")).toEqual([
      "b@x.org",
    ]);
  });
});
