import { describe, expect, it } from "vitest";

import { EXPIRY_REPORT, STOCK_REPORT } from "../test-data";
import {
  expiryTable,
  reportFileName,
  stockBatchesTable,
  stockItemsTable,
} from "./report-tables";

describe("report tables", () => {
  it("writes one row per item with the monthly flow and the low-stock label", () => {
    const table = stockItemsTable(STOCK_REPORT);
    expect(table.head).toHaveLength(table.body[0].length);
    expect(table.body).toEqual([
      ["Analgesics", "Paracetamol 500 mg", "tablet", 16, 20, 5, 0, -1, 30, 30, "2026-11-20", "Low"],
    ]);
  });

  it("writes one row per batch, labelling no-expiry batches", () => {
    const rows = stockBatchesTable(STOCK_REPORT).body;
    expect(rows.map((row) => row[1])).toEqual(["A-1", "A-2"]);
    expect(rows[0][3]).toBe("Near Expiry");
    expect(rows[1][2]).toBe("No expiry");
  });

  it("labels the expiry sections and names files by kind and month", () => {
    expect(expiryTable(EXPIRY_REPORT).body[0].slice(0, 2)).toEqual([
      "Expires this month",
      "Paracetamol 500 mg",
    ]);
    expect(reportFileName("expiry", "2026-11", "xlsx")).toBe(
      "meditract-expiry-report-2026-11.xlsx"
    );
  });
});
