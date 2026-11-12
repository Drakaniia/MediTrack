import { describe, expect, it } from "vitest";

import type { BatchDto, ItemSummaryDto } from "../../../shared/schemas/inventory";
import { scanCandidates } from "../../../shared/schemas/scan";
import { allowedActionsFor } from "./allowed-actions";

const ITEM = { available: 5 } as ItemSummaryDto;
const BATCH = { quarantined: false, status: "active" } as BatchDto;

describe("scanCandidates", () => {
  it("canonicalises batch-code shaped input and keeps the raw text for barcodes", () => {
    expect(scanCandidates(" mt:abcde-fghjk ")).toEqual({
      batchCode: "ABCDEFGHJK",
      text: "abcde-fghjk",
    });
  });

  it("gives no batch code for anything else", () => {
    expect(scanCandidates("5000000000017")).toEqual({
      batchCode: null,
      text: "5000000000017",
    });
    expect(scanCandidates("SYR-10")).toEqual({ batchCode: null, text: "SYR-10" });
  });
});

describe("allowedActionsFor", () => {
  it("gives nurses no stock-changing or label actions on a batch", () => {
    expect(
      allowedActionsFor("nurse", { batch: BATCH, item: ITEM, scannedBatch: true })
    ).toEqual(["view", "request", "quick_deduct"]);
  });

  it("hides quick deduct when nothing is available", () => {
    const actions = allowedActionsFor("admin", {
      batch: BATCH,
      item: { available: 0 } as ItemSummaryDto,
      scannedBatch: true,
    });
    expect(actions).not.toContain("quick_deduct");
  });

  it("offers dispose only on a quarantined scanned batch", () => {
    const expired = { ...BATCH, quarantined: true } as BatchDto;
    expect(
      allowedActionsFor("pharmacist", { batch: expired, item: ITEM, scannedBatch: true })
    ).toContain("dispose");
    expect(
      allowedActionsFor("pharmacist", { batch: expired, item: ITEM, scannedBatch: false })
    ).not.toContain("dispose");
  });
});
