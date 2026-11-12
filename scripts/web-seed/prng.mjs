/**
 * Deterministic randomness for the demo seed: the same dataset and base date always produce
 * the same ids and batch codes, so a rerun rewrites identical rows (idempotent).
 */

import { createHash } from "node:crypto";

const UINT32 = 4_294_967_296;
const UUID_BYTES = 16;
const VERSION_BYTE = 6;
const VARIANT_BYTE = 8;
const LOW_NIBBLE = 0x0f;
const VERSION_4 = 0x40;
const LOW_SIX_BITS = 0x3f;
const VARIANT_RFC = 0x80;
const MULBERRY_STEP = 0x6d_2b_79_f5;
const SHIFT_A = 15;
const SHIFT_B = 7;
const SHIFT_C = 14;
const OR_B = 61;

/** Crockford base32, the alphabet of `shared/batch-code.ts`. */
export const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_LENGTH = 10;
const SYMBOL_COUNT = CODE_ALPHABET.length;

/**
 * @param {string} text
 * @returns {number}
 */
export function seedFromString(text) {
  return createHash("sha256").update(text).digest().readUInt32BE(0);
}

/**
 * mulberry32: a tiny seeded PRNG returning floats in [0, 1).
 * @param {number} seed
 * @returns {() => number}
 */
export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + MULBERRY_STEP) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> SHIFT_A), t | 1);
    t ^= t + Math.imul(t ^ (t >>> SHIFT_B), t | OR_B);
    return ((t ^ (t >>> SHIFT_C)) >>> 0) / UINT32;
  };
}

/**
 * A stable UUID-shaped id for (namespace, kind, ref): independent of row order, so adding a
 * row to the dataset never renumbers the others.
 * @param {string} namespace
 * @returns {(kind: string, ref: string) => string}
 */
export function createIdFactory(namespace) {
  return (kind, ref) => {
    const bytes = createHash("sha256")
      .update(`${namespace}:${kind}:${ref}`)
      .digest()
      .subarray(0, UUID_BYTES);
    bytes[VERSION_BYTE] = (bytes[VERSION_BYTE] & LOW_NIBBLE) | VERSION_4;
    bytes[VARIANT_BYTE] = (bytes[VARIANT_BYTE] & LOW_SIX_BITS) | VARIANT_RFC;
    const hex = bytes.toString("hex");
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32),
    ].join("-");
  };
}

/**
 * Unique 10-character Crockford codes from a seeded PRNG.
 * @param {string} seedText
 * @returns {() => string}
 */
export function createCodeGenerator(seedText) {
  const random = mulberry32(seedFromString(seedText));
  const used = new Set();
  return () => {
    for (;;) {
      let code = "";
      for (let index = 0; index < CODE_LENGTH; index += 1) {
        code += CODE_ALPHABET.charAt(Math.floor(random() * SYMBOL_COUNT));
      }
      if (!used.has(code)) {
        used.add(code);
        return code;
      }
    }
  };
}
