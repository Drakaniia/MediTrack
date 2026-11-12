/**
 * Shared state of one demo-plan build: the dataset, the base date, the facility timezone, the
 * expiry thresholds and the deterministic id / batch-code / randomness sources.
 */

import {
  addDays,
  isIsoDate,
  isValidTimeZone,
  localMoment,
  resolveRelativeMoment,
} from "./dates.mjs";
import { SeedError } from "./errors.mjs";
import {
  createCodeGenerator,
  createIdFactory,
  mulberry32,
  seedFromString,
} from "./prng.mjs";

export const DEFAULT_DEMO_PASSWORD = "Demo-Password-2026";
export const DEFAULT_SEED = "meditract-demo";
/** Facility-local time at which a batch is booked in. */
export const RECEIVE_TIME = "08:30";
/** Facility-local time of the daily alert run (the cron Worker's default). */
export const DAILY_RUN_TIME = "06:00";

/**
 * @typedef {{ displayName: string, id: string, role: string }} DemoUser
 * @typedef {{
 *   hasExpiry: boolean, id: string, label: string, name: string,
 *   ref: string, threshold: number, unit: string,
 * }} DemoItem
 * @typedef {{
 *   at: (offset: number, time: string) => string,
 *   dataset: any,
 *   id: (kind: string, ref: string) => string,
 *   items: Map<string, DemoItem>,
 *   moment: (spec: string) => { date: string, iso: string, offset: number },
 *   nextCode: () => string,
 *   nextSeq: () => number,
 *   random: () => number,
 *   thresholds: { nearDays: number, urgentDays: number },
 *   timeZone: string,
 *   today: string,
 *   users: Map<string, DemoUser>,
 * }} DemoContext
 */

/**
 * @param {any} dataset
 * @param {{ thresholds: { nearDays: number, urgentDays: number }, timeZone: string, today: string }} options
 * @returns {DemoContext}
 */
export function createContext(dataset, options) {
  const { thresholds, timeZone, today } = options;
  if (!isIsoDate(today)) {
    throw new SeedError(`The base date must be YYYY-MM-DD, got "${today}".`);
  }
  if (!isValidTimeZone(timeZone)) {
    throw new SeedError(`Unknown facility timezone "${timeZone}".`);
  }
  for (const key of ["users", "categories", "items", "batches", "dispensing", "requests"]) {
    if (!Array.isArray(dataset?.[key])) {
      throw new SeedError(`demo-data.json: "${key}" must be an array.`);
    }
  }
  const seed = dataset.seed ?? DEFAULT_SEED;
  let sequence = 0;
  return {
    at: (offset, time) => localMoment(addDays(today, offset), time, timeZone),
    dataset,
    id: createIdFactory(seed),
    items: new Map(),
    moment: (spec) => resolveRelativeMoment(spec, today, timeZone),
    nextCode: createCodeGenerator(`${seed}:batch-code`),
    nextSeq: () => {
      sequence += 1;
      return sequence;
    },
    random: mulberry32(seedFromString(`${seed}:notification-state`)),
    thresholds,
    timeZone,
    today,
    users: new Map(),
  };
}

/**
 * @param {DemoContext} ctx
 * @param {string} ref
 * @param {string} where
 * @returns {DemoUser}
 */
export function requireUser(ctx, ref, where) {
  const user = ctx.users.get(ref);
  if (!user) {
    throw new SeedError(`demo-data.json: ${where} names unknown user "${ref}".`);
  }
  return user;
}

/**
 * @param {DemoContext} ctx
 * @param {string} ref
 * @param {string} where
 * @returns {DemoItem}
 */
export function requireItem(ctx, ref, where) {
  const item = ctx.items.get(ref);
  if (!item) {
    throw new SeedError(`demo-data.json: ${where} names unknown item "${ref}".`);
  }
  return item;
}
