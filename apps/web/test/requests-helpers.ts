/** Shared arrangement helpers for the REQ API tests (not a test file). */

import type { Role } from "../shared/roles";
import type { DispenseResultDto, RequestDto } from "../shared/schemas/requests";
import {
  createTestApp,
  type TestApp,
  type TestClient,
  type TestUser,
} from "./app";
import { insertBatch, insertItem } from "./fixtures";

export interface Actor {
  /** Replaced by `relogin` after the test clock jumped past the session lifetime. */
  client: TestClient;
  user: TestUser;
}

export interface World {
  admin: Actor;
  app: TestApp;
  healthAdmin: Actor;
  inventory: Actor;
  nurse: Actor;
  pharmacist: Actor;
}

async function actor(app: TestApp, role: Role): Promise<Actor> {
  const user = await app.createUser({ role });
  return { client: await app.login(user), user };
}

export async function createWorld(now?: string): Promise<World> {
  const app = await createTestApp(now === undefined ? {} : { now });
  return {
    admin: await actor(app, "admin"),
    app,
    healthAdmin: await actor(app, "health_admin"),
    inventory: await actor(app, "inventory"),
    nurse: await actor(app, "nurse"),
    pharmacist: await actor(app, "pharmacist"),
  };
}

/** Signs everybody in again (sessions expire by the server's clock when a test jumps days ahead). */
export async function relogin(world: World): Promise<void> {
  for (const who of [
    world.admin,
    world.healthAdmin,
    world.inventory,
    world.nurse,
    world.pharmacist,
  ]) {
    who.client = await world.app.login(who.user);
  }
}

export interface StockSpec {
  expiry?: string | null;
  qty: number;
  received?: string;
}

/** An item with one batch per spec (FEFO order is decided by expiry, then received date). */
export function stockItem(
  app: TestApp,
  specs: readonly StockSpec[],
  name = "Paracetamol"
): { batchIds: string[]; itemId: string } {
  const itemId = insertItem(app.sqlite, {
    name,
    strength: "500 mg",
    unit: "tab",
  });
  const batchIds = specs.map((spec, index) =>
    insertBatch(app.sqlite, {
      batchNumber: `LOT-${String.fromCharCode(65 + index)}`,
      expiry: spec.expiry === undefined ? "2027-03-12" : spec.expiry,
      itemId,
      qty: spec.qty,
      receivedOn: spec.received ?? "2026-11-01",
    })
  );
  return { batchIds, itemId };
}

export async function createRequest(
  client: TestClient,
  itemId: string,
  qty: number
): Promise<RequestDto> {
  const response = await client.post<RequestDto[]>("/api/requests", {
    lines: [{ itemId, qty }],
  });
  if (response.status !== 201) {
    throw new Error(
      `create request failed: ${response.status} ${response.error?.message ?? ""}`
    );
  }
  return response.data[0];
}

/** Creates a request and walks it to Ready to Claim as the pharmacist. */
export async function readyRequest(
  world: World,
  itemId: string,
  qty: number
): Promise<RequestDto> {
  const request = await createRequest(world.nurse.client, itemId, qty);
  for (const to of ["approved", "ready"]) {
    const moved = await world.pharmacist.client.post(
      `/api/requests/${request.id}/transition`,
      { to }
    );
    if (moved.status !== 200) {
      throw new Error(`transition to ${to} failed: ${moved.error?.message}`);
    }
  }
  return request;
}

export async function dispense(
  client: TestClient,
  requestId: string,
  body: Record<string, unknown> = {}
) {
  return await client.post<DispenseResultDto>(
    `/api/requests/${requestId}/dispense`,
    body
  );
}

export function rows<T>(
  app: TestApp,
  sql: string,
  ...values: (string | number)[]
): T[] {
  return app.sqlite.prepare(sql).all(...values) as T[];
}

export function count(app: TestApp, table: string, where = "1 = 1"): number {
  const row = app.sqlite
    .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`)
    .get() as { n: number };
  return row.n;
}
