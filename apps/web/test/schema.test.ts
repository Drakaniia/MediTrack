import { describe, expect, it } from "vitest";

import {
  applyMigrations,
  createFakeD1,
  createMigratedD1,
  D1_MAX_BOUND_PARAMETERS,
  migrationFiles,
} from "./harness";

const NOW = "2026-11-12T02:00:00.000Z";

async function insertItem(
  d1: ReturnType<typeof createMigratedD1>,
  id: string,
  name: string
): Promise<void> {
  await d1
    .prepare(
      "INSERT INTO items (id, name, strength, created_at, updated_at) VALUES (?, ?, '', ?, ?)"
    )
    .bind(id, name, NOW, NOW)
    .run();
}

async function insertBatch(
  d1: ReturnType<typeof createMigratedD1>,
  fields: { batchNumber: string; code: string; id: string; itemId: string; qty: number }
): Promise<void> {
  await d1
    .prepare(
      `INSERT INTO batches (id, item_id, code, batch_number, batch_number_lower, expiry, qty, initial_qty, received_on)
       VALUES (?, ?, ?, ?, ?, '2027-01-31', ?, ?, '2026-11-01')`
    )
    .bind(
      fields.id,
      fields.itemId,
      fields.code,
      fields.batchNumber,
      fields.batchNumber.toLowerCase(),
      fields.qty,
      fields.qty
    )
    .run();
}

describe("schema", () => {
  it("applies every migration to an empty database", async () => {
    const d1 = createFakeD1();
    const applied = applyMigrations(d1.sqlite);
    expect(applied).toEqual(migrationFiles());

    const { results } = await d1
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all<{ name: string }>();
    const tables = results.map((row) => row.name);
    for (const expected of [
      "alert_state",
      "audit_log",
      "batches",
      "categories",
      "counters",
      "dispensing_lines",
      "dispensing_records",
      "disposals",
      "items",
      "job_runs",
      "login_attempts",
      "low_stock_state",
      "notification_state",
      "notifications",
      "push_subscriptions",
      "request_events",
      "requests",
      "sessions",
      "settings",
      "stock_movements",
      "users",
    ]) {
      expect(tables).toContain(expected);
    }
  });

  it("refuses negative batch quantities", async () => {
    const d1 = createMigratedD1();
    await insertItem(d1, "item-1", "Paracetamol");
    await insertBatch(d1, {
      batchNumber: "B1",
      code: "ABCDEFGHJK",
      id: "batch-1",
      itemId: "item-1",
      qty: 5,
    });
    await expect(
      d1.prepare("UPDATE batches SET qty = qty - 6 WHERE id = 'batch-1'").run()
    ).rejects.toThrow(/CHECK constraint failed/);
  });

  it("enforces unique batch numbers per item, case-insensitively, among live rows only", async () => {
    const d1 = createMigratedD1();
    await insertItem(d1, "item-1", "Paracetamol");
    await insertBatch(d1, {
      batchNumber: "LOT-1",
      code: "AAAAAAAAAA",
      id: "batch-1",
      itemId: "item-1",
      qty: 1,
    });
    await expect(
      insertBatch(d1, {
        batchNumber: "lot-1",
        code: "BBBBBBBBBB",
        id: "batch-2",
        itemId: "item-1",
        qty: 1,
      })
    ).rejects.toThrow(/UNIQUE constraint failed/);

    await d1
      .prepare("UPDATE batches SET deleted_at = ? WHERE id = 'batch-1'")
      .bind(NOW)
      .run();
    await insertBatch(d1, {
      batchNumber: "lot-1",
      code: "BBBBBBBBBB",
      id: "batch-2",
      itemId: "item-1",
      qty: 1,
    });
  });

  it("keeps the audit log append-only", async () => {
    const d1 = createMigratedD1();
    await d1
      .prepare(
        "INSERT INTO audit_log (at, actor_name, action, entity_type, summary) VALUES (?, 'Admin', 'test.event', 'test', 'created')"
      )
      .bind(NOW)
      .run();
    await expect(
      d1.prepare("UPDATE audit_log SET summary = 'edited'").run()
    ).rejects.toThrow(/append-only/);
    await expect(d1.prepare("DELETE FROM audit_log").run()).rejects.toThrow(
      /append-only/
    );
  });

  it("rolls the whole batch back when one statement fails", async () => {
    const d1 = createMigratedD1();
    await insertItem(d1, "item-1", "Paracetamol");
    await insertBatch(d1, {
      batchNumber: "B1",
      code: "ABCDEFGHJK",
      id: "batch-1",
      itemId: "item-1",
      qty: 5,
    });

    await expect(
      d1.batch([
        d1.prepare("UPDATE batches SET qty = qty - 3 WHERE id = 'batch-1'"),
        d1.prepare("UPDATE batches SET qty = qty - 3 WHERE id = 'batch-1'"),
      ])
    ).rejects.toThrow(/CHECK constraint failed/);

    const row = await d1
      .prepare("SELECT qty FROM batches WHERE id = 'batch-1'")
      .first<{ qty: number }>();
    expect(row?.qty).toBe(5);
  });

  it("mimics D1's bind limits", async () => {
    const d1 = createMigratedD1();
    const tooMany = Array.from({ length: D1_MAX_BOUND_PARAMETERS + 1 }, () => 1);
    const marks = tooMany.map(() => "?").join(",");
    await expect(
      d1.prepare(`SELECT ${marks}`).bind(...tooMany).all()
    ).rejects.toThrow(/too many SQL variables/);
    await expect(d1.prepare("SELECT ?").bind(undefined).all()).rejects.toThrow(
      /undefined/
    );
    await expect(d1.prepare("SELECT ?").bind(true).all()).rejects.toThrow(
      /boolean/
    );
  });
});
