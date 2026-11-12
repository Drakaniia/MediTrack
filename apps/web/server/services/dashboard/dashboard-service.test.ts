import { describe, expect, it } from "vitest";

import { createTestApp, type TestApp } from "../../../test/app";
import {
  dashboardActor,
  insertDispensing,
  insertRequest,
} from "../../../test/dashboard-helpers";
import { insertBatch, insertItem } from "../../../test/fixtures";
import type { D1DatabaseLike } from "../../env";
import { loadDashboard } from "./dashboard-service";

const MAX_STATEMENTS = 14;
const BULK_ITEMS = 300;

interface Counter {
  db: D1DatabaseLike;
  statements: () => number;
}

/** Counts every statement prepared and every batch sent to the database. */
function counting(db: D1DatabaseLike): Counter {
  let total = 0;
  return {
    db: {
      batch: (statements) => {
        total += 1;
        return db.batch(statements);
      },
      exec: (query) => db.exec(query),
      prepare: (sql) => {
        total += 1;
        return db.prepare(sql);
      },
    },
    statements: () => total,
  };
}

async function statementsFor(
  app: TestApp,
  role: "admin" | "nurse"
): Promise<number> {
  const counter = counting(app.db);
  await loadDashboard(counter.db, { now: app.clock.now(), role });
  return counter.statements();
}

function seedStock(
  app: TestApp,
  items: number,
  by: string,
  prefix = "Bulk"
): void {
  for (let index = 0; index < items; index += 1) {
    const name = `${prefix} ${index}`;
    const itemId = insertItem(app.sqlite, {
      lowStockThreshold: index % 3 === 0 ? 20 : 0,
      name,
    });
    for (const offset of [-3, 5, 20, 90]) {
      insertBatch(app.sqlite, {
        batchNumber: `B${offset}`,
        expiry: new Date(Date.UTC(2026, 10, 12 + offset)).toISOString().slice(0, 10),
        itemId,
        qty: 4,
      });
    }
    insertRequest(app.sqlite, { itemId, itemName: name });
    insertDispensing(app.sqlite, { by, itemId, itemName: name });
  }
}

describe("loadDashboard query budget", () => {
  it("runs the same small number of statements for 3 items and for 300", async () => {
    const app = await createTestApp();
    const admin = await dashboardActor(app, "admin");

    seedStock(app, 3, admin.userId, "Small");
    const small = await statementsFor(app, "admin");
    const smallNurse = await statementsFor(app, "nurse");

    seedStock(app, BULK_ITEMS, admin.userId);
    const large = await statementsFor(app, "admin");
    const largeNurse = await statementsFor(app, "nurse");

    expect(large).toBe(small);
    expect(largeNurse).toBe(smallNurse);
    expect(large).toBeLessThanOrEqual(MAX_STATEMENTS);
    // Fewer cards, fewer statements: the nurse never reaches the dispensing or activity queries.
    expect(largeNurse).toBeLessThan(large);
  });

  it("still returns correct totals with 300 items", async () => {
    const app = await createTestApp();
    const admin = await dashboardActor(app, "admin");
    seedStock(app, BULK_ITEMS, admin.userId);

    const body = await loadDashboard(app.db, {
      now: app.clock.now(),
      role: "admin",
    });

    expect(body.totals.itemCount).toBe(BULK_ITEMS);
    expect(body.totals.classes.expired).toEqual({ batches: BULK_ITEMS, units: BULK_ITEMS * 4 });
    expect(body.totals.classes.urgent.batches).toBe(BULK_ITEMS);
    expect(body.totals.classes.near_expiry.batches).toBe(BULK_ITEMS);
    expect(body.totals.classes.safe.batches).toBe(BULK_ITEMS);
    expect(body.useFirst).toHaveLength(8);
    expect(body.recentDispensing).toHaveLength(8);
    expect(body.pendingRequests?.counts.pending).toBe(BULK_ITEMS);
  });
});
