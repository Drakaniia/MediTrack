/**
 * Demo plan, part 2: requests and their event trail.
 *
 * Queue requests are listed in the dataset with their status history up to "ready"; the hand-over
 * events are derived from the linked dispensing records exactly as `queue-dispense.ts` writes
 * them (ready -> ready "Partial hand-over: x of y", ready -> claimed "Handed over x of y").
 * A Quick Deduct request is derived entirely from its dispensing record (claimed straight away,
 * cancelled when the record was undone), mirroring `quick-deduct-service.ts`.
 */

import { requireItem, requireUser } from "./demo-context.mjs";
import { todayInZone } from "./dates.mjs";
import { SeedError } from "./errors.mjs";

export const REQUEST_STATUSES = [
  "pending",
  "approved",
  "ready",
  "claimed",
  "denied",
  "cancelled",
];
const DENIED_REASONS = ["Out of Stock", "Not Available", "Duplicate Request", "Other"];
const CODE_PAD = 4;
const QUICK_DEDUCT_NOTE = "Quick deduct";

/**
 * @typedef {{
 *   actor: import("./demo-context.mjs").DemoUser, at: string, from: string | null,
 *   note: string, to: string,
 * }} RequestEvent
 */

/**
 * @param {RequestEvent[]} events
 * @param {string} where
 */
function assertChronological(events, where) {
  for (let index = 1; index < events.length; index += 1) {
    if (events[index].at < events[index - 1].at) {
      throw new SeedError(`demo-data.json: ${where}: events are not in time order.`);
    }
  }
}

/**
 * @param {import("./demo-context.mjs").DemoContext} ctx
 * @param {any} def
 * @param {any[]} linked
 */
function quickDeductRequest(ctx, def, linked) {
  const where = `request "${def.ref}"`;
  if (linked.length !== 1 || linked[0].source !== "quick_deduct") {
    throw new SeedError(`demo-data.json: ${where} needs exactly one quick_deduct dispensing record.`);
  }
  const [record] = linked;
  const item = requireItem(ctx, record.itemRef, where);
  /** @type {RequestEvent[]} */
  const events = [
    { actor: record.by, at: record.at, from: null, note: QUICK_DEDUCT_NOTE, to: "claimed" },
  ];
  if (record.undoneAt !== null) {
    events.push({
      actor: record.by,
      at: record.undoneAt,
      from: "claimed",
      note: "Quick deduct undone",
      to: "cancelled",
    });
  }
  const last = events.at(-1);
  return {
    denied: null,
    dispensedQty: record.qty,
    events,
    item,
    qty: record.qty,
    reason: record.note,
    requestedBy: record.by,
    requestor: record.recipient,
    requestorRef: "",
    source: "quick_deduct",
    status: last?.to ?? "claimed",
    submittedAt: record.at,
  };
}

/**
 * @param {import("./demo-context.mjs").DemoContext} ctx
 * @param {any} def
 * @param {any[]} linked
 */
function queueRequest(ctx, def, linked) {
  const where = `request "${def.ref}"`;
  const item = requireItem(ctx, def.item, where);
  const requestedBy = requireUser(ctx, def.requestedBy, where);
  const submitted = ctx.moment(def.submitted);
  /** @type {RequestEvent[]} */
  const events = [
    { actor: requestedBy, at: submitted.iso, from: null, note: "", to: "pending" },
  ];
  for (const step of def.history ?? []) {
    events.push({
      actor: requireUser(ctx, step.by, where),
      at: ctx.moment(step.at).iso,
      from: events.at(-1)?.to ?? null,
      note: step.note ?? "",
      to: step.to,
    });
  }
  let handedOver = 0;
  const ordered = [...linked].sort((a, b) => (a.at < b.at ? -1 : 1));
  for (const record of ordered) {
    if (events.at(-1)?.to !== "ready") {
      throw new SeedError(`demo-data.json: ${where} is dispensed before it was ready.`);
    }
    handedOver += record.qty;
    const complete = handedOver >= def.qty;
    events.push({
      actor: record.by,
      at: record.at,
      from: "ready",
      note: complete
        ? `Handed over ${handedOver} of ${def.qty}`
        : `Partial hand-over: ${handedOver} of ${def.qty}`,
      to: complete ? "claimed" : "ready",
    });
  }
  if (events.at(-1)?.to !== def.status) {
    throw new SeedError(
      `demo-data.json: ${where} says "${def.status}" but its history ends at "${events.at(-1)?.to}".`
    );
  }
  if (handedOver > def.qty) {
    throw new SeedError(`demo-data.json: ${where} is handed over more than requested.`);
  }
  if (def.status === "denied" && !DENIED_REASONS.includes(def.denied?.reason)) {
    throw new SeedError(`demo-data.json: ${where} is denied without a valid reason.`);
  }
  return {
    denied: def.status === "denied" ? def.denied : null,
    dispensedQty: handedOver,
    events,
    item,
    qty: def.qty,
    reason: def.reason ?? "",
    requestedBy,
    requestor: def.requestor ?? "",
    requestorRef: def.requestorRef ?? "",
    source: "queue",
    status: def.status,
    submittedAt: submitted.iso,
  };
}

/**
 * @param {import("./demo-context.mjs").DemoContext} ctx
 * @param {any[]} dispensingMeta
 */
export function buildRequests(ctx, dispensingMeta) {
  const defs = ctx.dataset.requests;
  const refs = new Set(defs.map(/** @param {any} def */ (def) => def.ref));
  for (const record of dispensingMeta) {
    if (record.requestRef !== null && !refs.has(record.requestRef)) {
      throw new SeedError(
        `demo-data.json: dispensing "${record.ref}" points at unknown request "${record.requestRef}".`
      );
    }
  }
  const built = defs.map(
    /** @param {any} def */ (def) => {
      const linked = dispensingMeta.filter(
        /** @param {any} record */ (record) => record.requestRef === def.ref
      );
      const detail =
        def.source === "quick_deduct"
          ? quickDeductRequest(ctx, def, linked)
          : queueRequest(ctx, def, linked);
      assertChronological(detail.events, `request "${def.ref}"`);
      return { def, detail };
    }
  );

  // Codes: REQ-<facility year>-NNNN in submission order, one counter per year.
  const byTime = [...built].sort((a, b) =>
    a.detail.submittedAt < b.detail.submittedAt ? -1 : 1
  );
  /** @type {Map<string, string>} */
  const codes = new Map();
  /** @type {Map<number, number>} */
  const perYear = new Map();
  for (const { def, detail } of byTime) {
    const year = Number(
      todayInZone(new Date(detail.submittedAt), ctx.timeZone).slice(0, 4)
    );
    const next = (perYear.get(year) ?? 0) + 1;
    perYear.set(year, next);
    codes.set(def.ref, `REQ-${year}-${String(next).padStart(CODE_PAD, "0")}`);
  }

  /** @type {Map<string, number>} */
  const positions = new Map();
  const requests = [];
  const events = [];
  for (const { def, detail } of built) {
    const id = ctx.id("request", def.ref);
    const position = positions.get(detail.status) ?? 0;
    positions.set(detail.status, position + 1);
    const last = detail.events.at(-1);
    requests.push({
      id,
      code: codes.get(def.ref),
      item_id: detail.item.id,
      item_name: detail.item.label,
      unit: detail.item.unit,
      qty: detail.qty,
      dispensed_qty: detail.dispensedQty,
      status: detail.status,
      source: detail.source,
      reason: detail.reason,
      requestor_name: detail.requestor,
      requestor_ref: detail.requestorRef,
      requestor_email: "",
      requested_by: detail.requestedBy.id,
      denied_reason: detail.denied?.reason ?? null,
      denied_note: detail.denied?.note ?? "",
      board_position: position,
      submitted_at: detail.submittedAt,
      claimed_at: detail.status === "claimed" ? last?.at ?? null : null,
      archived_at: null,
      updated_at: last?.at ?? detail.submittedAt,
    });
    for (const [index, event] of detail.events.entries()) {
      events.push({
        id: ctx.id("request-event", `${def.ref}:${index}`),
        request_id: id,
        at: event.at,
        from_status: event.from,
        to_status: event.to,
        actor_id: event.actor.id,
        actor_name: event.actor.displayName,
        note: event.note,
      });
    }
  }
  const counters = [...perYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, value]) => ({ name: `request:${year}`, value }));
  return { codes, counters, events, requests };
}
