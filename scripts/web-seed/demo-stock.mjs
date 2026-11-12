/**
 * Demo plan, part 1: people, catalogue and stock.
 *
 * The dataset lists each batch's CURRENT quantity and the dispensing / adjustment / disposal
 * events. This module derives what must be true for the ledger to add up: `initial_qty`, one
 * `stock_movements` row per change with a running `qty_after`, the per-batch
 * `dispensing_lines`, and the `disposals` records. Any inconsistency in the dataset (a batch
 * going negative, dispensing before the batch arrived or after it expired, a disposal that is
 * not the last event) throws a `SeedError` naming the batch, so the dataset cannot rot silently.
 */

import { createHash } from "node:crypto";

import { hashAdminPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, SALT_BYTES } from "./admin.mjs";
import {
  DEFAULT_DEMO_PASSWORD,
  RECEIVE_TIME,
  requireItem,
  requireUser,
} from "./demo-context.mjs";
import { SeedError } from "./errors.mjs";
import { classifyExpiry } from "./expiry.mjs";

const USER_CREATED_OFFSET = -60;
const CATALOGUE_FALLBACK_OFFSET = -60;
const ITEM_CREATED_TIME = "07:50";
const DISPOSAL_REASON_LABELS = {
  damaged: "Damaged",
  expired: "Expired",
  other: "Other",
  recalled: "Recalled",
};
const SOURCES = ["queue", "quick_deduct"];

/** @type {Map<string, string>} */
const hashCache = new Map();

/**
 * Deterministic salt per username, so a rerun writes identical SQL (the password is public demo
 * data anyway).
 * @param {string} password
 * @param {string} username
 * @param {number} iterations
 */
function demoPasswordHash(password, username, iterations) {
  const key = `${iterations}|${username}|${password}`;
  const cached = hashCache.get(key);
  if (cached) {
    return cached;
  }
  const salt = createHash("sha256")
    .update(`meditract-demo-salt:${username}`)
    .digest()
    .subarray(0, SALT_BYTES);
  const hash = hashAdminPassword(password, { iterations, salt });
  hashCache.set(key, hash);
  return hash;
}

/**
 * @param {string | undefined} password
 * @returns {string}
 */
export function resolveDemoPassword(password) {
  const value = password ?? DEFAULT_DEMO_PASSWORD;
  if (value.length < PASSWORD_MIN_LENGTH || value.length > PASSWORD_MAX_LENGTH) {
    throw new SeedError(
      `The demo password must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters (WEB_DEMO_PASSWORD).`
    );
  }
  return value;
}

/**
 * @param {import("./demo-context.mjs").DemoContext} ctx
 * @param {{ iterations: number, password: string }} credentials
 */
export function buildUsers(ctx, { iterations, password }) {
  const createdAt = ctx.at(USER_CREATED_OFFSET, "09:00");
  return ctx.dataset.users.map(
    /** @param {any} def */ (def) => {
      const id = ctx.id("user", def.ref);
      ctx.users.set(def.ref, { displayName: def.displayName, id, role: def.role });
      return {
        id,
        username: def.username,
        username_lower: def.username.toLowerCase(),
        email: def.email ?? null,
        email_lower: def.email ? def.email.toLowerCase() : null,
        display_name: def.displayName,
        role: def.role,
        password_hash: demoPasswordHash(password, def.username, iterations),
        must_change_password: 0,
        disabled_at: null,
        last_login_at: null,
        password_changed_at: createdAt,
        created_by: null,
        created_at: createdAt,
        updated_at: createdAt,
      };
    }
  );
}

/** @param {import("./demo-context.mjs").DemoContext} ctx */
export function buildCategories(ctx) {
  const createdAt = ctx.at(-420, "08:00");
  /** @type {Map<string, string>} */
  const idByName = new Map();
  const rows = ctx.dataset.categories.map(
    /** @param {string} name @param {number} index */ (name, index) => {
      const id = ctx.id("category", name.toLowerCase());
      idByName.set(name, id);
      return {
        id,
        name,
        name_lower: name.toLowerCase(),
        sort_order: index,
        created_at: createdAt,
      };
    }
  );
  return { idByName, rows };
}

/** @param {import("./demo-context.mjs").DemoContext} ctx */
function earliestReceived(ctx) {
  /** @type {Map<string, number>} */
  const earliest = new Map();
  for (const batch of ctx.dataset.batches) {
    const known = earliest.get(batch.item);
    if (known === undefined || batch.received < known) {
      earliest.set(batch.item, batch.received);
    }
  }
  return earliest;
}

/**
 * @param {import("./demo-context.mjs").DemoContext} ctx
 * @param {Map<string, string>} categoryIds
 */
export function buildItems(ctx, categoryIds) {
  const earliest = earliestReceived(ctx);
  const inventory = requireUser(
    ctx,
    ctx.dataset.defaults?.inventoryUser ?? "inventory",
    "defaults.inventoryUser"
  );
  return ctx.dataset.items.map(
    /** @param {any} def */ (def) => {
      if (ctx.items.has(def.ref)) {
        throw new SeedError(`demo-data.json: duplicate item "${def.ref}".`);
      }
      const categoryId = categoryIds.get(def.category);
      if (categoryId === undefined) {
        throw new SeedError(
          `demo-data.json: item "${def.ref}" has unknown category "${def.category}".`
        );
      }
      const id = ctx.id("item", def.ref);
      const label = `${def.name} ${def.strength ?? ""}`.trim();
      ctx.items.set(def.ref, {
        hasExpiry: def.hasExpiry !== false,
        id,
        label,
        name: def.name,
        ref: def.ref,
        supplier: def.supplier ?? "",
        threshold: def.lowStockThreshold ?? 0,
        unit: def.unit,
      });
      const createdAt = ctx.at(
        earliest.get(def.ref) ?? CATALOGUE_FALLBACK_OFFSET,
        ITEM_CREATED_TIME
      );
      return {
        id,
        name: def.name,
        strength: def.strength ?? "",
        category_id: categoryId,
        unit: def.unit,
        pack_unit: def.packUnit ?? "",
        pack_size: def.packSize ?? null,
        supplier: def.supplier ?? "",
        sku: def.sku ?? null,
        barcode: def.barcode ?? null,
        low_stock_threshold: def.lowStockThreshold ?? 0,
        has_expiry: def.hasExpiry === false ? 0 : 1,
        notes: def.notes ?? "",
        deleted_at: null,
        deleted_by: null,
        created_by: inventory.id,
        created_at: createdAt,
        updated_at: createdAt,
      };
    }
  );
}

/**
 * @typedef {{
 *   actor: import("./demo-context.mjs").DemoUser, at: string, delta: number, kind: string,
 *   note: string, reason: string, refId: string | null, refType: string | null, seq: number,
 * }} StockEvent
 * @typedef {{
 *   def: any, disposal: any, disposedQty: number, events: StockEvent[], expiry: string | null,
 *   id: string, item: import("./demo-context.mjs").DemoItem, number: string,
 *   receivedOffset: number, receiveAt: string,
 * }} BatchState
 */

/**
 * @param {import("./demo-context.mjs").DemoContext} ctx
 * @returns {Map<string, BatchState>}
 */
function createBatchStates(ctx) {
  /** @type {Map<string, BatchState>} */
  const states = new Map();
  const identities = new Set();
  for (const def of ctx.dataset.batches) {
    const where = `batch "${def.number}"`;
    const item = requireItem(ctx, def.item, where);
    const identity = `${def.item}|${def.number.toLowerCase()}`;
    if (states.has(def.number) || identities.has(identity)) {
      throw new SeedError(`demo-data.json: duplicate ${where}.`);
    }
    identities.add(identity);
    const dated = typeof def.expiry === "number";
    if (!(dated || def.expiry === null)) {
      throw new SeedError(`demo-data.json: ${where} needs "expiry" (days or null).`);
    }
    if (dated === !item.hasExpiry) {
      throw new SeedError(
        `demo-data.json: ${where}: expiry must be ${item.hasExpiry ? "set" : "null"} for "${def.item}".`
      );
    }
    if (!Number.isInteger(def.received) || def.received > 0) {
      throw new SeedError(`demo-data.json: ${where}: "received" must be a day offset <= 0.`);
    }
    states.set(def.number, {
      def,
      disposal: null,
      disposedQty: 0,
      events: [],
      expiry: dated ? ctx.moment(`${def.expiry}d 00:00`).date : null,
      id: ctx.id("batch", def.number),
      item,
      number: def.number,
      receiveAt: ctx.at(def.received, RECEIVE_TIME),
      receivedOffset: def.received,
    });
  }
  return states;
}

/**
 * @param {import("./demo-context.mjs").DemoContext} ctx
 * @param {BatchState} state
 * @param {Omit<StockEvent, "seq">} event
 */
function pushEvent(ctx, state, event) {
  if (event.at <= state.receiveAt) {
    throw new SeedError(
      `demo-data.json: batch "${state.number}" has an event before it was received.`
    );
  }
  state.events.push({ ...event, seq: ctx.nextSeq() });
}

/**
 * Adjustments and the optional disposal of every batch.
 * @param {import("./demo-context.mjs").DemoContext} ctx
 * @param {Map<string, BatchState>} states
 */
function registerBatchEvents(ctx, states) {
  for (const state of states.values()) {
    const where = `batch "${state.number}"`;
    for (const adjustment of state.def.adjustments ?? []) {
      if (!Number.isInteger(adjustment.delta) || adjustment.delta === 0) {
        throw new SeedError(`demo-data.json: ${where}: adjustment delta must be a non-zero integer.`);
      }
      pushEvent(ctx, state, {
        actor: requireUser(ctx, adjustment.by, where),
        at: ctx.moment(adjustment.at).iso,
        delta: adjustment.delta,
        kind: "adjust",
        note: adjustment.note ?? "",
        reason: adjustment.reason ?? "Adjustment",
        refId: null,
        refType: null,
      });
    }
    const disposal = state.def.disposal;
    if (disposal) {
      if (!(disposal.reason in DISPOSAL_REASON_LABELS)) {
        throw new SeedError(`demo-data.json: ${where}: unknown disposal reason.`);
      }
      const moment = ctx.moment(disposal.at);
      state.disposal = { ...disposal, at: moment.iso, id: ctx.id("disposal", state.number) };
      pushEvent(ctx, state, {
        actor: requireUser(ctx, disposal.by, where),
        at: moment.iso,
        delta: 0,
        kind: "dispose",
        note: disposal.note ?? "",
        reason: DISPOSAL_REASON_LABELS[disposal.reason],
        refId: state.disposal.id,
        refType: "disposal",
      });
    }
  }
}

/**
 * Time order, ties broken by the order the events were queued.
 * @param {StockEvent} a
 * @param {StockEvent} b
 */
function byTime(a, b) {
  if (a.at === b.at) {
    return a.seq - b.seq;
  }
  return a.at < b.at ? -1 : 1;
}

/**
 * Dispensing records and their per-batch lines; queues the matching ledger events.
 * @param {import("./demo-context.mjs").DemoContext} ctx
 * @param {Map<string, BatchState>} states
 */
function buildDispensing(ctx, states) {
  const records = [];
  const lines = [];
  /** @type {any[]} */
  const meta = [];
  const refs = new Set();
  for (const def of ctx.dataset.dispensing) {
    const where = `dispensing "${def.ref}"`;
    if (refs.has(def.ref)) {
      throw new SeedError(`demo-data.json: duplicate ${where}.`);
    }
    refs.add(def.ref);
    if (!SOURCES.includes(def.source)) {
      throw new SeedError(`demo-data.json: ${where}: unknown source.`);
    }
    const item = requireItem(ctx, def.item, where);
    const user = requireUser(ctx, def.by, where);
    const when = ctx.moment(def.at);
    const undoneAt = def.undoneAt ? ctx.moment(def.undoneAt).iso : null;
    if (undoneAt !== null && (def.source !== "quick_deduct" || undoneAt < when.iso)) {
      throw new SeedError(`demo-data.json: ${where}: only a quick deduct can be undone, after it happened.`);
    }
    const id = ctx.id("dispensing", def.ref);
    let total = 0;
    for (const [index, line] of def.lines.entries()) {
      const state = states.get(line.batch);
      if (!state || state.item !== item) {
        throw new SeedError(`demo-data.json: ${where}: batch "${line.batch}" is not a batch of "${def.item}".`);
      }
      if (!Number.isInteger(line.qty) || line.qty <= 0) {
        throw new SeedError(`demo-data.json: ${where}: line quantities must be positive integers.`);
      }
      if (when.offset < state.receivedOffset) {
        throw new SeedError(`demo-data.json: ${where} is before batch ${state.number} arrived.`);
      }
      if (state.expiry !== null && when.date > state.expiry) {
        throw new SeedError(`demo-data.json: ${where} is after batch ${state.number} expired.`);
      }
      total += line.qty;
      lines.push({
        id: ctx.id("dispensing-line", `${def.ref}:${index}`),
        record_id: id,
        batch_id: state.id,
        batch_number: state.number,
        expiry: state.expiry,
        qty: line.qty,
      });
      const reason = def.source === "queue" ? "Request hand-over" : "Quick deduct";
      pushEvent(ctx, state, {
        actor: user, at: when.iso, delta: -line.qty, kind: "dispense",
        note: def.note ?? "", reason, refId: id, refType: "dispensing_record",
      });
      if (undoneAt !== null) {
        pushEvent(ctx, state, {
          actor: user, at: undoneAt, delta: line.qty, kind: "undo_dispense",
          note: "", reason: "Quick deduct undone", refId: id, refType: "dispensing_record",
        });
      }
    }
    records.push({
      id,
      request_id: def.request ? ctx.id("request", def.request) : null,
      item_id: item.id,
      item_name: item.label,
      unit: item.unit,
      qty: total,
      source: def.source,
      recipient_name: def.recipient ?? "",
      dispensed_by: user.id,
      dispensed_by_name: user.displayName,
      dispensed_at: when.iso,
      undone_at: undoneAt,
      undone_by: undoneAt === null ? null : user.id,
      note: def.note ?? "",
    });
    meta.push({
      at: when.iso, by: user, id, itemRef: def.item, note: def.note ?? "",
      qty: total, recipient: def.recipient ?? "", ref: def.ref,
      requestRef: def.request ?? null, source: def.source, undoneAt,
    });
  }
  return { lines, meta, records };
}

/**
 * Settles one batch: derives `initial_qty`, walks its events in time order, checks the balance
 * never goes negative and ends at the dataset's `qty`.
 * @param {import("./demo-context.mjs").DemoContext} ctx
 * @param {BatchState} state
 * @param {import("./demo-context.mjs").DemoUser} receiver
 */
function settleBatch(ctx, state, receiver) {
  const { def } = state;
  const where = `batch "${state.number}"`;
  const events = [...state.events].sort(byTime);
  const sumOfChanges = events
    .filter((event) => event.kind !== "dispose")
    .reduce((sum, event) => sum + event.delta, 0);
  let initial = def.qty - sumOfChanges;
  if (state.disposal) {
    if (def.qty !== 0 || !Number.isInteger(def.initialQty)) {
      throw new SeedError(`demo-data.json: ${where} is disposed: it needs "qty": 0 and "initialQty".`);
    }
    initial = def.initialQty;
  } else if (def.initialQty !== undefined && def.initialQty !== initial) {
    throw new SeedError(`demo-data.json: ${where}: initialQty ${def.initialQty} contradicts the events (${initial}).`);
  }
  if (!Number.isInteger(initial) || initial <= 0) {
    throw new SeedError(`demo-data.json: ${where} would have received ${initial} units.`);
  }
  const movements = [];
  let balance = initial;
  /** @param {Omit<StockEvent, "seq">} event */
  const record = (event) =>
    movements.push({
      id: ctx.id("movement", `${state.number}:${movements.length}`),
      at: event.at,
      item_id: state.item.id,
      batch_id: state.id,
      item_name: state.item.label,
      batch_number: state.number,
      kind: event.kind,
      qty_delta: event.delta,
      qty_after: balance,
      reason: event.reason,
      note: event.note,
      ref_type: event.refType,
      ref_id: event.refId,
      actor_id: event.actor.id,
      actor_name: event.actor.displayName,
    });
  record({
    actor: receiver, at: state.receiveAt, delta: initial, kind: "receive",
    note: "", reason: "Received", refId: null, refType: null,
  });
  for (const [index, event] of events.entries()) {
    if (event.kind === "dispose") {
      if (index !== events.length - 1 || balance <= 0) {
        throw new SeedError(`demo-data.json: ${where}: the disposal must be the last event and leave stock to dispose.`);
      }
      event.delta = -balance;
      state.disposedQty = balance;
    }
    balance += event.delta;
    if (balance < 0) {
      throw new SeedError(`demo-data.json: ${where} would go below zero at ${event.at}.`);
    }
    record(event);
  }
  if (balance !== def.qty) {
    throw new SeedError(`demo-data.json: ${where} ends at ${balance}, expected ${def.qty}.`);
  }
  return { initial, movements, updatedAt: events.at(-1)?.at ?? state.receiveAt };
}

/**
 * Batches, ledger, disposals, dispensing.
 * @param {import("./demo-context.mjs").DemoContext} ctx
 */
export function buildStock(ctx) {
  const receiver = requireUser(
    ctx,
    ctx.dataset.defaults?.inventoryUser ?? "inventory",
    "defaults.inventoryUser"
  );
  const states = createBatchStates(ctx);
  registerBatchEvents(ctx, states);
  const dispensing = buildDispensing(ctx, states);

  const batches = [];
  const movements = [];
  const disposals = [];
  /** @type {any[]} */
  const batchInfos = [];
  for (const state of states.values()) {
    const { initial, movements: rows, updatedAt } = settleBatch(ctx, state, receiver);
    const { def } = state;
    const disposed = state.disposal !== null;
    const row = {
      id: state.id,
      item_id: state.item.id,
      code: ctx.nextCode(),
      batch_number: state.number,
      batch_number_lower: state.number.toLowerCase(),
      barcode: def.barcode ?? null,
      expiry: state.expiry,
      qty: def.qty,
      initial_qty: initial,
      received_on: ctx.moment(`${def.received}d 00:00`).date,
      supplier: def.supplier ?? state.item.supplier,
      status: disposed ? "disposed" : "active",
      disposed_at: disposed ? state.disposal.at : null,
      deleted_at: null,
      deleted_by: null,
      deleted_with_item: 0,
      created_by: receiver.id,
      created_at: state.receiveAt,
      updated_at: updatedAt,
    };
    batches.push(row);
    movements.push(...rows);
    batchInfos.push({
      expiryClass: classifyExpiry(state.expiry, ctx.today, ctx.thresholds),
      row,
      state,
    });
    if (disposed) {
      const by = requireUser(ctx, state.disposal.by, `batch "${state.number}"`);
      disposals.push({
        id: state.disposal.id,
        batch_id: state.id,
        item_id: state.item.id,
        item_name: state.item.label,
        batch_number: state.number,
        expiry: state.expiry,
        qty: state.disposedQty,
        reason: state.disposal.reason,
        note: state.disposal.note ?? "",
        disposed_by: by.id,
        disposed_by_name: by.displayName,
        disposed_at: state.disposal.at,
      });
    }
  }
  return {
    batchInfos,
    batches,
    disposals,
    dispensingLines: dispensing.lines,
    dispensingMeta: dispensing.meta,
    dispensingRecords: dispensing.records,
    movements,
  };
}
