import { describe, expect, it } from "vitest";

import type {
  BulkImportResultDto,
  ItemDetailDto,
  ItemSummaryDto,
} from "../shared/schemas/inventory";
import { createTestApp, type TestApp } from "./app";
import { auditActions, insertBatch, insertItem } from "./fixtures";

interface Issue {
  field: string;
  message: string;
  path: string;
  row: number;
}

function issuesOf(error: { details?: unknown } | null): Issue[] {
  const details = error?.details as { issues: Issue[] };
  return details.issues;
}

function counts(app: TestApp) {
  const one = (sql: string) =>
    (app.sqlite.prepare(sql).get() as { n: number }).n;
  return {
    batches: one("SELECT COUNT(*) AS n FROM batches"),
    categories: one("SELECT COUNT(*) AS n FROM categories"),
    items: one("SELECT COUNT(*) AS n FROM items"),
    movements: one("SELECT COUNT(*) AS n FROM stock_movements"),
  };
}

const ROWS = [
  {
    batchNumber: "A-1",
    category: "Analgesic",
    expiry: "2027-03-01",
    name: "Paracetamol",
    qty: "100",
    sku: "PCM",
    strength: "500 mg",
    threshold: "30",
    unit: "tab",
  },
  {
    batchNumber: "A-2",
    expiry: "2027-09-01",
    name: "paracetamol",
    qty: "50",
    strength: "500 MG",
  },
  {
    batchNumber: "",
    category: "analgesic",
    expiry: "2027-01-01",
    name: "Ibuprofen",
    qty: 20,
    strength: "200 mg",
  },
  { hasExpiry: "no", name: "Wheelchair", qty: "2" },
  { expiry: "", name: "Catalogue only", strength: "" },
];

describe("POST /api/items/bulk", () => {
  it("creates items grouped by identity, with batches, ledger rows and categories", async () => {
    const app = await createTestApp();
    const admin = await app.loginAs("admin");
    const res = await admin.post<BulkImportResultDto>("/api/items/bulk", {
      rows: ROWS,
    });

    expect(res.status).toBe(201);
    expect(res.data).toEqual({
      batches: 4,
      categories: 1,
      dryRun: false,
      existingItems: 0,
      items: 4,
    });
    expect(counts(app)).toEqual({
      batches: 4,
      categories: 1,
      items: 4,
      movements: 4,
    });

    const list = await admin.get<ItemSummaryDto[]>("/api/items", {
      sort: "name",
    });
    const paracetamol = list.data.find((i) => i.name === "Paracetamol");
    expect(paracetamol).toMatchObject({
      batchCount: 2,
      categoryName: "Analgesic",
      lowStockThreshold: 30,
      onHand: 150,
      unit: "tab",
    });
    expect(list.data.find((i) => i.name === "Ibuprofen")?.categoryName).toBe(
      "Analgesic"
    );
    expect(list.data.find((i) => i.name === "Wheelchair")?.hasExpiry).toBe(
      false
    );
    const ibuprofen = await admin.get<ItemDetailDto>(
      `/api/items/${list.data.find((i) => i.name === "Ibuprofen")?.id}`
    );
    expect(ibuprofen.data.batches[0].batchNumber).toBe("IBU-261112-01");
    expect(auditActions(app.sqlite)).toEqual(
      expect.arrayContaining([
        "item.create",
        "category.create",
        "inventory.bulk_import",
      ])
    );
  });

  it("validates without writing on dryRun", async () => {
    const app = await createTestApp();
    const admin = await app.loginAs("admin");
    const res = await admin.post<BulkImportResultDto>("/api/items/bulk", {
      dryRun: true,
      rows: ROWS,
    });
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ batches: 4, dryRun: true, items: 4 });
    expect(counts(app)).toEqual({
      batches: 0,
      categories: 0,
      items: 0,
      movements: 0,
    });
  });

  it("reports every problem at once and writes nothing", async () => {
    const app = await createTestApp();
    const admin = await app.loginAs("admin");
    const res = await admin.post("/api/items/bulk", {
      rows: [
        { expiry: "2027-03-01", name: "Good", qty: "5" },
        { expiry: "2027-03-01", name: "", qty: "5" },
        { expiry: "03/01/2027", name: "Bad date", qty: "5" },
        { expiry: "2027-03-01", name: "No qty" },
        { expiry: "", name: "Needs expiry", qty: "3" },
        { expiry: "2027-03-01", name: "Bad qty", qty: "-4" },
        { expiry: "2027-03-01", hasExpiry: "no", name: "Wheelchair", qty: "1" },
        { batchNumber: "X", expiry: "2027-03-01", name: "Dup", qty: "1" },
        { batchNumber: "x", expiry: "2027-03-01", name: "Dup", qty: "1" },
      ],
    });
    expect(res.status).toBe(400);
    const issues = issuesOf(res.error);
    const byRow = issues.map((issue) => `${issue.row}:${issue.field}`);
    expect(byRow).toEqual([
      "2:name",
      "3:expiry",
      "4:qty",
      "5:expiry",
      "6:qty",
      "7:expiry",
      "9:batchNumber",
    ]);
    expect(issues[0].path).toBe("rows.1.name");
    expect(counts(app)).toEqual({
      batches: 0,
      categories: 0,
      items: 0,
      movements: 0,
    });
  });

  it("adds batches to an existing item and flags duplicates against it", async () => {
    const app = await createTestApp();
    const admin = await app.loginAs("admin");
    const id = insertItem(app.sqlite, {
      name: "Paracetamol",
      strength: "500 mg",
    });
    insertBatch(app.sqlite, { batchNumber: "OLD-1", itemId: id, qty: 5 });

    const duplicate = await admin.post("/api/items/bulk", {
      rows: [
        {
          batchNumber: "old-1",
          expiry: "2027-03-01",
          name: "Paracetamol",
          qty: "5",
          strength: "500 mg",
        },
      ],
    });
    expect(issuesOf(duplicate.error).map((i) => i.field)).toEqual([
      "batchNumber",
    ]);

    const ok = await admin.post<BulkImportResultDto>("/api/items/bulk", {
      rows: [
        {
          batchNumber: "NEW-1",
          expiry: "2027-03-01",
          name: "PARACETAMOL",
          qty: "7",
          strength: "500 mg",
        },
      ],
    });
    expect(ok.data).toMatchObject({ batches: 1, existingItems: 1, items: 0 });
    expect(counts(app)).toMatchObject({ batches: 2, items: 1, movements: 1 });
    expect(auditActions(app.sqlite)).toContain("batch.create");
  });

  it("refuses SKUs and barcodes that are taken", async () => {
    const app = await createTestApp();
    const admin = await app.loginAs("admin");
    insertItem(app.sqlite, { barcode: "777", name: "Existing", sku: "EX-1" });
    const res = await admin.post("/api/items/bulk", {
      rows: [
        { name: "A", sku: "ex-1" },
        { barcode: "777", name: "B" },
        { name: "C", sku: "NEW" },
        { name: "D", sku: "new" },
      ],
    });
    expect(issuesOf(res.error).map((i) => `${i.row}:${i.field}`)).toEqual([
      "1:sku",
      "2:barcode",
      "4:sku",
    ]);
  });

  it("writes large imports in several atomic chunks", async () => {
    const app = await createTestApp();
    const admin = await app.loginAs("admin");
    const rows = Array.from({ length: 120 }, (_, index) => ({
      batchNumber: `B-${index}`,
      expiry: "2027-03-01",
      name: `Bulk item ${String(index).padStart(3, "0")}`,
      qty: String(index + 1),
    }));
    const res = await admin.post<BulkImportResultDto>("/api/items/bulk", {
      rows,
    });
    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({ batches: 120, items: 120 });
    expect(counts(app)).toMatchObject({
      batches: 120,
      items: 120,
      movements: 120,
    });
    const list = await admin.get<ItemSummaryDto[]>("/api/items", {
      limit: 200,
    });
    expect(list.body).toMatchObject({ meta: { total: 120 } });
  });

  it("rejects empty and oversized payloads", async () => {
    const app = await createTestApp();
    const admin = await app.loginAs("admin");
    expect((await admin.post("/api/items/bulk", { rows: [] })).status).toBe(
      400
    );
    expect((await admin.post("/api/items/bulk", {})).status).toBe(400);
    const tooMany = Array.from({ length: 501 }, (_, index) => ({
      name: `n${index}`,
    }));
    expect(
      (await admin.post("/api/items/bulk", { rows: tooMany })).status
    ).toBe(400);
  });
});
