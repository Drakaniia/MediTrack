import { beforeEach, describe, expect, it } from "vitest";

import { ROLES, type Role } from "../shared/roles";
import type {
  ScanAction,
  ScanAmbiguousResult,
  ScanBatchResult,
  ScanItemResult,
  ScanNotFoundDetails,
  ScanResult,
} from "../shared/schemas/scan";
import { createTestApp, type TestApp, type TestClient } from "./app";
import { insertBatch, insertItem } from "./fixtures";

const CODE_A = "ABCDEFGHJK";
const CODE_B = "23456789MN";
const EXPIRED_ON = "2026-10-01";

let app: TestApp;
let admin: TestClient;

beforeEach(async () => {
  app = await createTestApp();
  admin = await app.loginAs("admin");
});

function scan(client: TestClient, code: string) {
  return client.get<ScanResult>("/api/scan", { code });
}

function seedItemWithBatch(
  itemFields: Parameters<typeof insertItem>[1] = {},
  batchFields: Partial<Parameters<typeof insertBatch>[1]> = {}
): { batchId: string; itemId: string } {
  const itemId = insertItem(app.sqlite, itemFields);
  const batchId = insertBatch(app.sqlite, { code: CODE_A, itemId, ...batchFields });
  return { batchId, itemId };
}

describe("GET /api/scan resolution tiers", () => {
  it("resolves a batch code to the batch, its item and the actions", async () => {
    const { batchId, itemId } = seedItemWithBatch({ name: "Paracetamol", strength: "500 mg" });
    const res = await scan(admin, CODE_A);
    expect(res.status).toBe(200);
    const data = res.data as ScanBatchResult;
    expect(data.kind).toBe("batch");
    expect(data.batch.id).toBe(batchId);
    expect(data.batch.code).toBe(CODE_A);
    expect(data.item.id).toBe(itemId);
    expect(data.item.displayName).toBe("Paracetamol 500 mg");
    expect(data.batch.fefoRank).toBe(1);
  });

  it("resolves a batch barcode", async () => {
    const { batchId } = seedItemWithBatch({}, { barcode: "9780201379624" });
    const data = (await scan(admin, "9780201379624")).data as ScanBatchResult;
    expect(data.kind).toBe("batch");
    expect(data.batch.id).toBe(batchId);
  });

  it("resolves an item barcode to the item with its FEFO batch", async () => {
    const itemId = insertItem(app.sqlite, { barcode: "5000000000017", name: "Gauze" });
    insertBatch(app.sqlite, { batchNumber: "LATE", code: CODE_B, expiry: "2027-09-01", itemId });
    const first = insertBatch(app.sqlite, {
      batchNumber: "SOON",
      code: CODE_A,
      expiry: "2027-01-01",
      itemId,
    });
    const data = (await scan(admin, "5000000000017")).data as ScanItemResult;
    expect(data.kind).toBe("item");
    expect(data.item.id).toBe(itemId);
    expect(data.fefoBatch?.id).toBe(first);
  });

  it("resolves a SKU case-insensitively", async () => {
    const itemId = insertItem(app.sqlite, { name: "Syringe", sku: "SYR-10ml" });
    const data = (await scan(admin, "syr-10ML")).data as ScanItemResult;
    expect(data.kind).toBe("item");
    expect(data.item.id).toBe(itemId);
    expect(data.fefoBatch).toBeNull();
  });

  it("prefers a batch code over a barcode or SKU with the same text", async () => {
    const { batchId } = seedItemWithBatch({ name: "Real batch item" });
    insertItem(app.sqlite, { name: "Decoy", sku: CODE_A });
    const data = (await scan(admin, CODE_A)).data as ScanBatchResult;
    expect(data.kind).toBe("batch");
    expect(data.batch.id).toBe(batchId);
  });

  it("prefers a batch barcode over an item barcode", async () => {
    const { batchId } = seedItemWithBatch({}, { barcode: "1234567890123" });
    insertItem(app.sqlite, { barcode: "1234567890123", name: "Other" });
    const data = (await scan(admin, "1234567890123")).data as ScanBatchResult;
    expect(data.kind).toBe("batch");
    expect(data.batch.id).toBe(batchId);
  });

  it("returns ambiguous when an item barcode equals another item's SKU", async () => {
    const first = insertItem(app.sqlite, { barcode: "AMBIG-1", name: "Alpha" });
    const second = insertItem(app.sqlite, { name: "Beta", sku: "ambig-1" });
    const data = (await scan(admin, "AMBIG-1")).data as ScanAmbiguousResult;
    expect(data.kind).toBe("ambiguous");
    expect(data.items.map((item) => item.id)).toEqual([first, second]);
  });

  it("returns ambiguous when a batch barcode is shared by two items", async () => {
    const one = seedItemWithBatch({ name: "One" }, { barcode: "SHARED" });
    const twoItem = insertItem(app.sqlite, { name: "Two" });
    insertBatch(app.sqlite, { barcode: "SHARED", code: CODE_B, itemId: twoItem });
    const data = (await scan(admin, "SHARED")).data as ScanAmbiguousResult;
    expect(data.kind).toBe("ambiguous");
    expect(data.items.map((item) => item.id).sort()).toEqual([one.itemId, twoItem].sort());
  });

  it("resolves two batches of one item behind one barcode to the item", async () => {
    const { itemId } = seedItemWithBatch({}, { barcode: "LOTS", batchNumber: "L1" });
    insertBatch(app.sqlite, { barcode: "LOTS", batchNumber: "L2", code: CODE_B, itemId });
    const data = (await scan(admin, "LOTS")).data as ScanItemResult;
    expect(data.kind).toBe("item");
    expect(data.item.id).toBe(itemId);
  });
});

describe("GET /api/scan input handling", () => {
  it.each([
    ["lower case", "abcdefghjk"],
    ["grouped with a hyphen", "ABCDE-FGHJK"],
    ["MT: prefix", "MT:ABCDEFGHJK"],
    ["padded and prefixed lower case", "  mt:abcde fghjk \n"],
  ])("normalises a batch code (%s)", async (_label, typed) => {
    const { batchId } = seedItemWithBatch();
    const data = (await scan(admin, typed)).data as ScanBatchResult;
    expect(data.kind).toBe("batch");
    expect(data.batch.id).toBe(batchId);
  });

  it("maps look-alike letters to the canonical symbols", async () => {
    const { batchId } = seedItemWithBatch({}, { code: "1A2B3C4D5E" });
    const data = (await scan(admin, "lA2B3C4D5E")).data as ScanBatchResult;
    expect(data.batch.id).toBe(batchId);
  });

  it("strips an MT: prefix before matching a SKU", async () => {
    const itemId = insertItem(app.sqlite, { sku: "BOX-7" });
    const data = (await scan(admin, "MT:BOX-7")).data as ScanItemResult;
    expect(data.item.id).toBe(itemId);
  });

  it("trims surrounding whitespace on barcodes", async () => {
    const itemId = insertItem(app.sqlite, { barcode: "4006381333931" });
    const data = (await scan(admin, "  4006381333931  ")).data as ScanItemResult;
    expect(data.item.id).toBe(itemId);
  });

  it("rejects an empty or missing code with 400 validation_error", async () => {
    expect((await scan(admin, "")).error?.code).toBe("validation_error");
    expect((await scan(admin, "   ")).status).toBe(400);
    const missing = await admin.get("/api/scan");
    expect(missing.status).toBe(400);
    expect(missing.error?.code).toBe("validation_error");
  });

  it("requires a session", async () => {
    const res = await scan(app.anonymous, CODE_A);
    expect(res.status).toBe(401);
  });

  it("is not audited", async () => {
    seedItemWithBatch();
    const before = app.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number };
    await scan(admin, CODE_A);
    await scan(admin, "nope");
    const after = app.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number };
    expect(after.n).toBe(before.n);
  });
});

describe("GET /api/scan not found", () => {
  it("answers 404 scan_not_found with the code and canRegister", async () => {
    const res = await scan(admin, "  UNKNOWN-1 ");
    expect(res.status).toBe(404);
    expect(res.error?.code).toBe("scan_not_found");
    expect(res.error?.details).toEqual({ canRegister: true, code: "UNKNOWN-1" });
  });

  it("never resolves soft-deleted batches", async () => {
    seedItemWithBatch({}, { barcode: "GONE-1", deleted: true });
    expect((await scan(admin, CODE_A)).error?.code).toBe("scan_not_found");
    expect((await scan(admin, "GONE-1")).error?.code).toBe("scan_not_found");
  });

  it("never resolves a soft-deleted item, nor the batches of one", async () => {
    const itemId = insertItem(app.sqlite, { barcode: "ITEM-GONE", sku: "SKU-GONE" });
    insertBatch(app.sqlite, { code: CODE_A, itemId });
    app.sqlite.prepare("UPDATE items SET deleted_at = ? WHERE id = ?").run("2026-11-01T00:00:00.000Z", itemId);
    for (const code of [CODE_A, "ITEM-GONE", "sku-gone"]) {
      expect((await scan(admin, code)).error?.code).toBe("scan_not_found");
    }
  });

  it("does not let a deleted item's barcode shadow a live one", async () => {
    const dead = insertItem(app.sqlite, { barcode: "REUSED", name: "Old" });
    app.sqlite.prepare("UPDATE items SET deleted_at = ? WHERE id = ?").run("2026-11-01T00:00:00.000Z", dead);
    const live = insertItem(app.sqlite, { barcode: "REUSED", name: "New" });
    const data = (await scan(admin, "REUSED")).data as ScanItemResult;
    expect(data.item.id).toBe(live);
  });

  it.each([
    ["admin", true],
    ["inventory", true],
    ["pharmacist", false],
    ["nurse", false],
    ["health_admin", false],
  ] as [Role, boolean][])("canRegister for %s is %s", async (role, canRegister) => {
    const client = await app.loginAs(role);
    const res = await scan(client, "NOPE-123");
    expect(res.status).toBe(404);
    const details = res.error?.details as ScanNotFoundDetails | undefined;
    expect(details?.canRegister).toBe(canRegister);
  });
});

describe("GET /api/scan flags and actions", () => {
  it("flags an expired batch as quarantined and offers dispose", async () => {
    seedItemWithBatch({}, { expiry: EXPIRED_ON });
    const data = (await scan(admin, CODE_A)).data as ScanBatchResult;
    expect(data.batch.expiryClass).toBe("expired");
    expect(data.batch.quarantined).toBe(true);
    expect(data.batch.fefoRank).toBeNull();
    expect(data.allowedActions).toEqual([
      "view",
      "request",
      "dispose",
      "adjust",
      "label",
      "edit",
    ]);
  });

  it("does not offer dispose on a healthy batch", async () => {
    seedItemWithBatch();
    const data = (await scan(admin, CODE_A)).data as ScanBatchResult;
    expect(data.batch.quarantined).toBe(false);
    expect(data.allowedActions).not.toContain("dispose");
    expect(data.allowedActions).toContain("quick_deduct");
  });

  it("reports the FEFO rank so the SPA can say which batch to use first", async () => {
    const itemId = insertItem(app.sqlite);
    const first = insertBatch(app.sqlite, { batchNumber: "FIRST", code: CODE_B, expiry: "2027-01-01", itemId });
    insertBatch(app.sqlite, { batchNumber: "SECOND", code: CODE_A, expiry: "2027-06-01", itemId });
    const data = (await scan(admin, CODE_A)).data as ScanBatchResult;
    expect(data.batch.fefoRank).toBe(2);
    expect(data.fefoBatch?.id).toBe(first);
    const top = (await scan(admin, CODE_B)).data as ScanBatchResult;
    expect(top.fefoBatch?.id).toBe(first);
  });

  it("still resolves a disposed batch but offers no adjust", async () => {
    seedItemWithBatch({}, { qty: 0, status: "disposed" });
    const data = (await scan(admin, CODE_A)).data as ScanBatchResult;
    expect(data.batch.status).toBe("disposed");
    expect(data.allowedActions).not.toContain("adjust");
    expect(data.allowedActions).not.toContain("dispose");
  });

  const EXPECTED_ACTIONS: Record<Role, ScanAction[]> = {
    admin: ["view", "request", "quick_deduct", "adjust", "label", "edit"],
    health_admin: ["view"],
    inventory: ["view", "request", "quick_deduct", "adjust", "label", "edit"],
    nurse: ["view", "request", "quick_deduct"],
    pharmacist: ["view", "request", "quick_deduct", "adjust"],
  };

  it.each(ROLES)("lets %s scan and derives its allowed actions", async (role) => {
    seedItemWithBatch();
    const client = await app.loginAs(role);
    const res = await scan(client, CODE_A);
    expect(res.status).toBe(200);
    expect((res.data as ScanBatchResult).allowedActions).toEqual(EXPECTED_ACTIONS[role]);
  });

  it("offers label for an item scan only when it has a batch to label", async () => {
    const withBatch = insertItem(app.sqlite, { sku: "HAS-BATCH" });
    insertBatch(app.sqlite, { code: CODE_A, itemId: withBatch });
    insertItem(app.sqlite, { name: "Empty", sku: "NO-BATCH" });
    const full = (await scan(admin, "HAS-BATCH")).data as ScanItemResult;
    const empty = (await scan(admin, "NO-BATCH")).data as ScanItemResult;
    expect(full.allowedActions).toContain("label");
    expect(full.allowedActions).not.toContain("adjust");
    expect(empty.allowedActions).not.toContain("label");
    expect(empty.allowedActions).not.toContain("quick_deduct");
  });
});
