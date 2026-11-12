import { describe, expect, it } from "vitest";

import {
  BATCH_CODE_ALPHABET,
  BATCH_CODE_LENGTH,
  batchNumberKey,
  batchNumbersEqual,
  formatBatchCodeForDisplay,
  generateBatchCode,
  isBatchCode,
  normalizeBatchCode,
  normalizeBatchNumber,
  qrPayloadForBatch,
  suggestBatchNumber,
} from "./batch-code";

const SAMPLE_COUNT = 10_000;

describe("generateBatchCode", () => {
  it("is 10 characters long, all from the Crockford alphabet", () => {
    expect(BATCH_CODE_LENGTH).toBe(10);
    expect(BATCH_CODE_ALPHABET).toBe("0123456789ABCDEFGHJKMNPQRSTVWXYZ");
    expect(BATCH_CODE_ALPHABET).toHaveLength(32);
    for (const letter of "ILOU") {
      expect(BATCH_CODE_ALPHABET).not.toContain(letter);
    }
    const code = generateBatchCode();
    expect(code).toHaveLength(BATCH_CODE_LENGTH);
    expect(isBatchCode(code)).toBe(true);
  });

  it("maps each random byte to a symbol using its low 5 bits", () => {
    const bytes = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(generateBatchCode(() => bytes)).toBe("0123456789");
    expect(generateBatchCode(() => new Uint8Array(10).fill(255))).toBe(
      "ZZZZZZZZZZ"
    );
    // High bits are ignored: 0xE0 | n maps like n.
    const high = Uint8Array.from([
      0xe0, 0xe1, 0xea, 0xff, 0x20, 0x41, 0x7f, 0x80, 0x9f, 0xdf,
    ]);

    expect(generateBatchCode(() => high)).toBe(
      [0, 1, 10, 31, 0, 1, 31, 0, 31, 31]
        .map((index) => BATCH_CODE_ALPHABET.charAt(index))
        .join("")
    );
  });

  it("asks the random source for exactly the bytes it needs", () => {
    const requested: number[] = [];
    generateBatchCode((length) => {
      requested.push(length);
      return new Uint8Array(length);
    });
    expect(requested).toEqual([BATCH_CODE_LENGTH]);
  });

  it("rejects a random source that returns too few bytes", () => {
    expect(() => generateBatchCode(() => new Uint8Array(3))).toThrow(/need 10/);
  });

  it("uses every symbol about equally often (unbiased mapping)", () => {
    const counts = new Map<string, number>();
    for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
      for (const symbol of generateBatchCode()) {
        counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
      }
    }
    const expected = (SAMPLE_COUNT * BATCH_CODE_LENGTH) / 32;
    expect(counts.size).toBe(32);
    for (const symbol of BATCH_CODE_ALPHABET) {
      const seen = counts.get(symbol) ?? 0;
      expect(seen).toBeGreaterThan(expected * 0.85);
      expect(seen).toBeLessThan(expected * 1.15);
    }
  });

  it("does not repeat over 10k samples", () => {
    const codes = new Set<string>();
    for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
      codes.add(generateBatchCode());
    }
    expect(codes.size).toBe(SAMPLE_COUNT);
  });
});

describe("normalizeBatchCode", () => {
  const table: [string, string][] = [
    ["abcde fghjk", "ABCDEFGHJK"],
    ["  abcde-fghjk  ", "ABCDEFGHJK"],
    ["ABCDE-FGHJK", "ABCDEFGHJK"],
    ["MT:ABCDEFGHJK", "ABCDEFGHJK"],
    ["mt-abcde-fghjk", "ABCDEFGHJK"],
    ["MT: abcde fghjk", "ABCDEFGHJK"],
    ["OIL0O1LI23", "0110011123"],
    ["o", "0"],
    ["i", "1"],
    ["l", "1"],
    ["", ""],
    ["   ", ""],
    ["MTABCDEFGH", "MTABCDEFGH"],
    ["MT-", ""],
  ];

  it.each(table)("normalises %j to %j", (input, expected) => {
    expect(normalizeBatchCode(input)).toBe(expected);
  });

  it("is idempotent", () => {
    for (const [input] of table) {
      const once = normalizeBatchCode(input);
      expect(normalizeBatchCode(once)).toBe(once);
    }
  });

  it("round-trips a generated code through display and QR forms", () => {
    const code = generateBatchCode();
    expect(normalizeBatchCode(formatBatchCodeForDisplay(code))).toBe(code);
    expect(normalizeBatchCode(`MT:${code.toLowerCase()}`)).toBe(code);
    expect(qrPayloadForBatch(formatBatchCodeForDisplay(code))).toBe(code);
  });
});

describe("isBatchCode", () => {
  it("accepts valid codes in any friendly spelling", () => {
    expect(isBatchCode("ABCDEFGHJK")).toBe(true);
    expect(isBatchCode("abcde-fghjk")).toBe(true);
    expect(isBatchCode("MT:0123456789")).toBe(true);
    expect(isBatchCode("OIL0O1LI23")).toBe(true);
  });

  it("rejects wrong length, forbidden letters and empty input", () => {
    expect(isBatchCode("")).toBe(false);
    expect(isBatchCode("ABCDEFGHJ")).toBe(false);
    expect(isBatchCode("ABCDEFGHJKM")).toBe(false);
    expect(isBatchCode("ABCDEFGHJU")).toBe(false);
    expect(isBatchCode("ABCDEFGHJ!")).toBe(false);
    expect(isBatchCode("PARA-261112-01")).toBe(false);
  });
});

describe("display and QR forms", () => {
  it("groups a code as 5-5", () => {
    expect(formatBatchCodeForDisplay("abcdefghjk")).toBe("ABCDE-FGHJK");
    expect(formatBatchCodeForDisplay("MT:ABCDE-FGHJK")).toBe("ABCDE-FGHJK");
  });

  it("leaves a non-code ungrouped but normalised", () => {
    expect(formatBatchCodeForDisplay(" abc ")).toBe("ABC");
  });

  it("encodes only the bare normalised code in the QR", () => {
    expect(qrPayloadForBatch("abcde-fghjk")).toBe("ABCDEFGHJK");
    expect(qrPayloadForBatch("MT:ABCDEFGHJK")).toBe("ABCDEFGHJK");
  });
});

describe("batch numbers", () => {
  it("trims and collapses internal whitespace but keeps case", () => {
    expect(normalizeBatchNumber("  LOT   42\tA  ")).toBe("LOT 42 A");
    expect(normalizeBatchNumber("")).toBe("");
  });

  it("compares case-insensitively after normalising", () => {
    expect(batchNumberKey("  Lot  42 ")).toBe("lot 42");
    expect(batchNumbersEqual("LOT 42", "  lot   42 ")).toBe(true);
    expect(batchNumbersEqual("LOT 42", "LOT 43")).toBe(false);
    expect(batchNumbersEqual("", " ")).toBe(true);
  });
});

describe("suggestBatchNumber", () => {
  const base = { itemName: "Paracetamol 500 mg", receivedOn: "2026-11-12" };

  it("builds INITIALS-YYMMDD-01", () => {
    expect(suggestBatchNumber({ ...base, existingNumbers: [] })).toBe(
      "PM-261112-01"
    );
  });

  it("uses up to three initials", () => {
    expect(
      suggestBatchNumber({
        existingNumbers: [],
        itemName: "Oral Rehydration Salts Sachet",
        receivedOn: "2027-01-05",
      })
    ).toBe("ORS-270105-01");
  });

  it("uses the first three letters of a one-word name", () => {
    expect(
      suggestBatchNumber({
        existingNumbers: [],
        itemName: "Amoxicillin",
        receivedOn: "2026-02-03",
      })
    ).toBe("AMO-260203-01");
  });

  it("strips accents and ignores digits and punctuation", () => {
    expect(
      suggestBatchNumber({
        existingNumbers: [],
        itemName: "Éther (500) & Co.",
        receivedOn: "2026-11-12",
      })
    ).toBe("EC-261112-01");
  });

  it("falls back to ITM when the name has no letters", () => {
    for (const itemName of ["", "   ", "500", "---", "数"]) {
      expect(
        suggestBatchNumber({ ...base, existingNumbers: [], itemName })
      ).toBe("ITM-261112-01");
    }
  });

  it("takes the smallest unused number, case-insensitively", () => {
    expect(
      suggestBatchNumber({
        ...base,
        existingNumbers: ["pm-261112-01", " PM-261112-02 "],
      })
    ).toBe("PM-261112-03");
  });

  it("fills a gap and ignores other prefixes and days", () => {
    expect(
      suggestBatchNumber({
        ...base,
        existingNumbers: [
          "PM-261112-01",
          "PM-261112-03",
          "PM-261111-02",
          "XX-261112-02",
        ],
      })
    ).toBe("PM-261112-02");
  });

  it("keeps counting past 99 with at least two digits", () => {
    const existing = Array.from(
      { length: 99 },
      (_, index) => `PM-261112-${String(index + 1).padStart(2, "0")}`
    );
    expect(suggestBatchNumber({ ...base, existingNumbers: existing })).toBe(
      "PM-261112-100"
    );
  });

  it("rejects an invalid received date", () => {
    expect(() =>
      suggestBatchNumber({
        ...base,
        existingNumbers: [],
        receivedOn: "12/11/2026",
      })
    ).toThrow(RangeError);
  });

  it("does not mutate existingNumbers", () => {
    const existing = ["PM-261112-01"];
    suggestBatchNumber({ ...base, existingNumbers: existing });
    expect(existing).toEqual(["PM-261112-01"]);
  });
});
