/** Arrangement helpers for the DASH tests: rows written straight to SQLite. */

import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import type { Role } from "../shared/roles";
import type { DashboardDto } from "../shared/schemas/dashboard";
import type { TestApp, TestClient } from "./app";
import { FIXTURE_NOW } from "./fixtures";

let sequence = 0;

function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-d${String(sequence).padStart(5, "0")}`;
}

function run(sqlite: DatabaseSync, sql: string, values: SQLInputValue[]): void {
  sqlite.prepare(sql).run(...values);
}

export interface RequestFixture {
  archivedAt?: string | null;
  itemId?: string | null;
  itemName?: string;
  qty?: number;
  requestorName?: string;
  requestedBy?: string | null;
  status?: "approved" | "claimed" | "denied" | "pending" | "ready";
  submittedAt?: string;
}

export function insertRequest(
  sqlite: DatabaseSync,
  fields: RequestFixture = {}
): string {
  const id = nextId("req");
  run(
    sqlite,
    "INSERT INTO requests (id, code, item_id, item_name, unit, qty, status, requestor_name, requested_by, archived_at, submitted_at, updated_at) VALUES (?, ?, ?, ?, 'tab', ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      `REQ-${id}`,
      fields.itemId ?? null,
      fields.itemName ?? "Paracetamol",
      fields.qty ?? 5,
      fields.status ?? "pending",
      fields.requestorName ?? "",
      fields.requestedBy ?? null,
      fields.archivedAt ?? null,
      fields.submittedAt ?? FIXTURE_NOW,
      FIXTURE_NOW,
    ]
  );
  return id;
}

export interface DispensingFixture {
  at?: string;
  by: string;
  itemId?: string | null;
  itemName?: string;
  lines?: { batchNumber: string; qty: number }[];
  qty?: number;
  undone?: boolean;
}

export function insertDispensing(
  sqlite: DatabaseSync,
  fields: DispensingFixture
): string {
  const id = nextId("disp");
  const lines = fields.lines ?? [{ batchNumber: "LOT-A", qty: fields.qty ?? 3 }];
  const qty = fields.qty ?? lines.reduce((sum, line) => sum + line.qty, 0);
  run(
    sqlite,
    "INSERT INTO dispensing_records (id, item_id, item_name, unit, qty, source, dispensed_by, dispensed_by_name, dispensed_at, undone_at) VALUES (?, ?, ?, 'tab', ?, 'quick_deduct', ?, 'Dana Pharmacist', ?, ?)",
    [
      id,
      fields.itemId ?? null,
      fields.itemName ?? "Paracetamol",
      qty,
      fields.by,
      fields.at ?? FIXTURE_NOW,
      fields.undone ? (fields.at ?? FIXTURE_NOW) : null,
    ]
  );
  for (const line of lines) {
    run(
      sqlite,
      "INSERT INTO dispensing_lines (id, record_id, batch_number, qty) VALUES (?, ?, ?, ?)",
      [nextId("line"), id, line.batchNumber, line.qty]
    );
  }
  return id;
}

export function insertDisposal(
  sqlite: DatabaseSync,
  fields: { at: string; by: string; qty: number }
): void {
  run(
    sqlite,
    "INSERT INTO disposals (id, item_name, batch_number, qty, reason, disposed_by, disposed_by_name, disposed_at) VALUES (?, 'Old stock', 'LOT-X', ?, 'expired', ?, 'Dana Pharmacist', ?)",
    [nextId("dsp"), fields.qty, fields.by, fields.at]
  );
}

export function insertReceive(
  sqlite: DatabaseSync,
  fields: { at: string; qty: number }
): void {
  run(
    sqlite,
    "INSERT INTO stock_movements (id, at, item_name, batch_number, kind, qty_delta, qty_after) VALUES (?, ?, 'Paracetamol', 'LOT-A', 'receive', ?, ?)",
    [nextId("mov"), fields.at, fields.qty, fields.qty]
  );
}

export interface Dashboarder {
  client: TestClient;
  userId: string;
}

export async function dashboardActor(
  app: TestApp,
  role: Role
): Promise<Dashboarder> {
  const user = await app.createUser({ role });
  return { client: await app.login(user), userId: user.id };
}

export async function fetchDashboard(
  client: TestClient,
  month?: string
): Promise<DashboardDto> {
  const response = await client.get<DashboardDto>("/api/dashboard", { month });
  if (response.status !== 200) {
    throw new Error(
      `GET /api/dashboard failed: ${response.status} ${response.error?.message ?? ""}`
    );
  }
  return response.data;
}
