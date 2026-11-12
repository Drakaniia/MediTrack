import { describe, expect, it } from "vitest";

import {
  buildLabel,
  buildLabels,
  clampCopies,
  type LabelBatch,
  LABEL_SIZE_IDS,
  LABEL_SIZES,
  labelsPerPage,
  MAX_COPIES,
  pageCount,
  paginate,
  truncateText,
  truncateTitle,
} from "./label-layout";

const BATCH: LabelBatch = {
  batchNumber: "LOT-7",
  code: "abcde-fghjk",
  expiry: "2027-03-12",
  id: "b1",
  itemName: "Paracetamol",
  strength: "500 mg",
};

const A4 = LABEL_SIZES["a4-3x8"];
const ROLL = LABEL_SIZES["50x30"];

describe("label sizes", () => {
  it.each(LABEL_SIZE_IDS)("%s: the grid of labels fits on the page", (id) => {
    const size = LABEL_SIZES[id];
    expect(size.columns * size.labelWidthMm).toBeLessThanOrEqual(size.pageWidthMm);
    expect(size.rows * size.labelHeightMm).toBeLessThanOrEqual(size.pageHeightMm);
    expect(size.qrMm).toBeLessThan(Math.min(size.labelWidthMm, size.labelHeightMm));
  });

  it("counts labels per page", () => {
    expect(labelsPerPage(ROLL)).toBe(1);
    expect(labelsPerPage(LABEL_SIZES["70x40"])).toBe(1);
    expect(labelsPerPage(A4)).toBe(24);
  });
});

describe("pagination", () => {
  it("rounds the page count up", () => {
    expect(pageCount(0, A4)).toBe(0);
    expect(pageCount(1, A4)).toBe(1);
    expect(pageCount(24, A4)).toBe(1);
    expect(pageCount(25, A4)).toBe(2);
    expect(pageCount(3, ROLL)).toBe(3);
  });

  it("fills A4 sheets in order and leaves the last one partly empty", () => {
    const labels = Array.from({ length: 50 }, (_, index) => index);
    const pages = paginate(labels, A4);
    expect(pages.map((page) => page.length)).toEqual([24, 24, 2]);
    expect(pages.flat()).toEqual(labels);
  });

  it("gives every roll label its own page", () => {
    expect(paginate(["a", "b", "c"], ROLL)).toEqual([["a"], ["b"], ["c"]]);
  });

  it("returns no pages for no labels", () => {
    expect(paginate([], A4)).toEqual([]);
  });
});

describe("text truncation", () => {
  it("leaves short text alone and trims padding", () => {
    expect(truncateText("  Gauze ", 28)).toBe("Gauze");
  });

  it("cuts long text to the limit including the ellipsis", () => {
    const cut = truncateText("abcdefghij", 5);
    expect(cut).toBe("abcd…");
    expect(cut).toHaveLength(5);
  });

  it("keeps the strength whole and shortens the name first", () => {
    const title = truncateTitle("Amoxicillin trihydrate dispersible tablets", "250 mg", 28);
    expect(title).toBe("Amoxicillin trihydra… 250 mg");
    expect(title).toHaveLength(28);
  });

  it("keeps a title that already fits", () => {
    expect(truncateTitle("Paracetamol", "500 mg", 28)).toBe("Paracetamol 500 mg");
    expect(truncateTitle("Gauze", "", 28)).toBe("Gauze");
  });

  it("cuts the whole line when the strength leaves no room for the name", () => {
    const title = truncateTitle("Gel", "x".repeat(40), 28);
    expect(title).toHaveLength(28);
    expect(title.endsWith("…")).toBe(true);
  });

  it("never exceeds the limit", () => {
    for (const max of [10, 20, 28, 36]) {
      const title = truncateTitle("A very long product name indeed", "1000 mg / 5 ml", max);
      expect(title.length).toBeLessThanOrEqual(max);
    }
  });
});

describe("buildLabel", () => {
  it("shows the product, lot, expiry and the code in human form; the QR is the bare code", () => {
    expect(buildLabel(BATCH, ROLL)).toEqual({
      batchNumber: "LOT-7",
      codeDisplay: "ABCDE-FGHJK",
      expiryText: "Exp 12 Mar 2027",
      key: "b1:1",
      qrPayload: "ABCDEFGHJK",
      title: "Paracetamol 500 mg",
    });
  });

  it("says so when the stock never expires", () => {
    expect(buildLabel({ ...BATCH, expiry: null }, ROLL).expiryText).toBe("No expiry");
  });

  it("truncates a long item name to the size's limit", () => {
    const label = buildLabel(
      { ...BATCH, itemName: "Extended release metformin hydrochloride", strength: "500 mg" },
      ROLL
    );
    expect(label.title.length).toBeLessThanOrEqual(ROLL.maxTitleChars);
    expect(label.title.endsWith("500 mg")).toBe(true);
  });
});

describe("buildLabels", () => {
  it("makes one label per batch per copy, copies together, with unique keys", () => {
    const labels = buildLabels([BATCH, { ...BATCH, id: "b2" }], ROLL, 3);
    expect(labels).toHaveLength(6);
    expect(labels.map((label) => label.key)).toEqual([
      "b1:1",
      "b1:2",
      "b1:3",
      "b2:1",
      "b2:2",
      "b2:3",
    ]);
  });

  it("clamps the number of copies", () => {
    expect(clampCopies(0)).toBe(1);
    expect(clampCopies(2.7)).toBe(2);
    expect(clampCopies(999)).toBe(MAX_COPIES);
    expect(clampCopies(Number.NaN)).toBe(1);
  });
});
