import { describe, expect, it } from "vitest";
import {
  type DigestInput,
  type DigestTransition,
  isQuietDigest,
  renderDigest,
} from "./digest-render";

function transition(
  overrides: Partial<DigestTransition> = {}
): DigestTransition {
  return {
    batchNumber: "B-100",
    daysUntil: 8,
    expiry: "2026-11-20",
    from: "near_expiry",
    itemName: "Amoxicillin 500mg",
    to: "urgent",
    ...overrides,
  };
}

function input(overrides: Partial<DigestInput> = {}): DigestInput {
  return {
    appUrl: "https://meditract.example.org",
    counts: { expired: 1, lowStock: 0, nearExpiry: 0, safe: 40, urgent: 3 },
    facilityName: "Sunrise Clinic",
    localDate: "2026-11-12",
    lowStock: [],
    transitions: [transition()],
    ...overrides,
  };
}

describe("renderDigest subject", () => {
  it("lists non-zero urgent and expired counts with facility and date", () => {
    expect(renderDigest(input()).subject).toBe(
      "[MediTract] 3 urgent, 1 expired \u2014 Sunrise Clinic 2026-11-12"
    );
  });

  it("omits zero parts and includes near expiry and low stock when present", () => {
    const { subject } = renderDigest(
      input({
        counts: { expired: 0, lowStock: 2, nearExpiry: 4, safe: 1, urgent: 0 },
      })
    );
    expect(subject).toBe(
      "[MediTract] 4 near expiry, 2 low stock \u2014 Sunrise Clinic 2026-11-12"
    );
  });

  it("uses Daily summary for a quiet digest", () => {
    const quiet = input({ lowStock: [], transitions: [] });
    expect(renderDigest(quiet).subject).toBe(
      "[MediTract] Daily summary \u2014 Sunrise Clinic 2026-11-12"
    );
  });

  it("uses Daily summary when every count is zero", () => {
    const { subject } = renderDigest(
      input({
        counts: { expired: 0, lowStock: 0, nearExpiry: 0, safe: 9, urgent: 0 },
      })
    );
    expect(subject).toContain("Daily summary");
  });

  it("keeps CR/LF out of the subject", () => {
    const { subject } = renderDigest(
      input({ facilityName: "Evil\r\nBcc: x@y.z" })
    );
    expect(subject).not.toMatch(/[\r\n]/);
  });
});

describe("isQuietDigest", () => {
  it("is quiet only with no transitions and no low-stock entries", () => {
    expect(isQuietDigest(input({ lowStock: [], transitions: [] }))).toBe(true);
    expect(isQuietDigest(input())).toBe(false);
    expect(
      isQuietDigest(
        input({
          lowStock: [
            { itemName: "Gauze", onHand: 2, threshold: 10, unit: "box" },
          ],
          transitions: [],
        })
      )
    ).toBe(false);
  });
});

describe("renderDigest content", () => {
  it("spells out status as text in HTML and plain text", () => {
    const rendered = renderDigest(
      input({
        transitions: [
          transition({ to: "urgent" }),
          transition({ batchNumber: "B-2", from: null, to: "near_expiry" }),
          transition({ batchNumber: "B-3", daysUntil: -3, to: "expired" }),
        ],
      })
    );
    for (const label of [
      "Urgent",
      "Near Expiry",
      "Expired",
      "Safe",
      "Low Stock",
    ]) {
      expect(rendered.html).toContain(label);
      expect(rendered.text).toContain(label);
    }
    expect(rendered.text).toContain("New \u2192 Near Expiry");
    expect(rendered.text).toContain("Near Expiry \u2192 Urgent");
    expect(rendered.text).toContain("3 days ago");
    expect(rendered.text).toContain("in 8 days");
    expect(rendered.text).toContain("Safe: 40 | Near Expiry: 0 | Urgent: 3");
  });

  it("renders low-stock rows", () => {
    const rendered = renderDigest(
      input({
        lowStock: [
          { itemName: "Gauze", onHand: 2, threshold: 10, unit: "box" },
        ],
      })
    );
    expect(rendered.text).toContain("- Gauze: 2 box (min 10)");
    expect(rendered.html).toContain("2 box (min 10)");
  });

  it("uses table-based inline-styled HTML", () => {
    const { html } = renderDigest(input());
    expect(html).toContain("<table");
    expect(html).toContain('style="');
    expect(html).not.toContain("<style");
    expect(html).not.toContain("<script");
  });

  it("says nothing changed for a quiet digest", () => {
    const rendered = renderDigest(input({ lowStock: [], transitions: [] }));
    expect(rendered.text).toContain("No changes since the last summary.");
    expect(rendered.html).toContain("No changes since the last summary.");
  });
});

describe("renderDigest escaping", () => {
  const evil = '<script>alert("x")</script>';

  it("escapes item, batch, facility, unit and from values in HTML", () => {
    const { html } = renderDigest(
      input({
        facilityName: evil,
        lowStock: [{ itemName: evil, onHand: 1, threshold: 2, unit: "<u>" }],
        transitions: [
          transition({ batchNumber: "<b>1</b>", from: "<i>", itemName: evil }),
        ],
      })
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<b>1</b>");
    expect(html).not.toContain("<i>");
    expect(html).not.toContain("<u>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).toContain("&lt;b&gt;1&lt;/b&gt;");
  });

  it("does not HTML-escape the plain-text alternative", () => {
    const { text } = renderDigest(
      input({ transitions: [transition({ itemName: "Tom & Jerry <mix>" })] })
    );
    expect(text).toContain("Tom & Jerry <mix>");
  });

  it("escapes quotes in the link href", () => {
    const { html } = renderDigest(
      input({ appUrl: 'https://example.org/?a="b"&c=<d>' })
    );
    expect(html).not.toContain('"b"');
    expect(html).not.toContain("<d>");
  });
});

describe("renderDigest truncation", () => {
  const many = Array.from({ length: 25 }, (_, index) =>
    transition({ batchNumber: `B-${index}`, itemName: `Item ${index}` })
  );

  it("shows 20 rows by default and reports the rest", () => {
    const rendered = renderDigest(input({ transitions: many }));
    expect(rendered.text).toContain("Item 19");
    expect(rendered.text).not.toContain("Item 20 ");
    expect(rendered.text).toContain("...and 5 more");
    expect(rendered.html).toContain("Item 19");
    expect(rendered.html).not.toContain("Item 20<");
    expect(rendered.html).toContain("&hellip;and 5 more");
  });

  it("honours maxRows for each table", () => {
    const rendered = renderDigest(
      input({
        lowStock: [
          { itemName: "A", onHand: 1, threshold: 5, unit: "u" },
          { itemName: "B", onHand: 1, threshold: 5, unit: "u" },
          { itemName: "C", onHand: 1, threshold: 5, unit: "u" },
        ],
        maxRows: 2,
        transitions: many,
      })
    );
    expect(rendered.text).toContain("...and 23 more");
    expect(rendered.text).toContain("...and 1 more");
    expect(rendered.text).not.toContain("- C:");
  });

  it("does not show a truncation note when everything fits", () => {
    const rendered = renderDigest(input());
    expect(rendered.text).not.toContain("more");
    expect(rendered.html).not.toContain("and 0 more");
  });
});

describe("renderDigest link", () => {
  it("links to the app for a valid http(s) URL", () => {
    const rendered = renderDigest(input());
    expect(rendered.html).toContain('href="https://meditract.example.org/"');
    expect(rendered.text).toContain(
      "Open MediTract: https://meditract.example.org/"
    );
  });

  it("accepts http URLs", () => {
    expect(
      renderDigest(input({ appUrl: "http://localhost:5173/app" })).html
    ).toContain('href="http://localhost:5173/app"');
  });

  it("omits the link for empty, invalid or non-http URLs", () => {
    for (const appUrl of [
      "",
      "not a url",
      "javascript:alert(1)",
      "mailto:a@b.co",
    ]) {
      const rendered = renderDigest(input({ appUrl }));
      expect(rendered.html).not.toContain("<a ");
      expect(rendered.text).not.toContain("Open MediTract");
    }
  });
});
