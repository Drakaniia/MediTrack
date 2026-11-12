/**
 * Password hashing: WebCrypto PBKDF2-SHA256 (spec §8.4).
 *
 * Stored format, EXACTLY (the seed script `scripts/web-seed-admin.mjs` produces
 * the same string with `node:crypto`):
 *
 *   pbkdf2-sha256$<iterations>$<salt base64url>$<hash base64url>
 *
 * 16-byte salt, 32-byte derived key. Cloudflare Workers' WebCrypto REFUSES more
 * than 100 000 PBKDF2 iterations, so that is the ceiling for both hashing and
 * verifying: a hash with more iterations cannot be checked in production and is
 * treated as invalid here too (same behaviour in tests and on the edge).
 */

import type { Env } from "../env";
import {
  base64UrlDecode,
  base64UrlEncode,
  randomBytes,
  timingSafeEqualBytes,
} from "./crypto";

const SCHEME = "pbkdf2-sha256";
const encoder = new TextEncoder();

export const PASSWORD_SALT_BYTES = 16;
export const PASSWORD_KEY_BYTES = 32;
export const DEFAULT_PASSWORD_ITERATIONS = 100_000;
export const MIN_PASSWORD_ITERATIONS = 10_000;
export const MAX_PASSWORD_ITERATIONS = 100_000;

const BITS_PER_BYTE = 8;
const STORED_PARTS = 4;
const MIN_STORED_SALT_BYTES = 8;
const MAX_STORED_BYTES = 64;
const MIN_STORED_KEY_BYTES = 16;
const DIGITS_ONLY = /^\d{1,7}$/;

/**
 * Verifies against a hash that matches no real password, so a login for an unknown
 * (or disabled) account costs the same PBKDF2 work as a real one. The key is random
 * bytes, not derived from any password; the login route also ignores the result.
 */
export const DUMMY_PASSWORD_HASH =
  "pbkdf2-sha256$100000$JWU52okw93sFU1ovAWWoew$76IBUlOm-zXzpma19M8omCsDT29_47pLu2FeTeq2YqY";

export interface HashPasswordOptions {
  /** 1 … 100 000. Defaults to 100 000; routes pass `iterationsFromEnv(env)`. */
  iterations?: number;
  /** Fixed salt, for tests. Defaults to 16 fresh random bytes. */
  salt?: Uint8Array<ArrayBuffer>;
}

export interface PasswordCheck {
  /** True when the password matched but the stored hash is weaker than today's target. */
  needsRehash: boolean;
  ok: boolean;
}

interface ParsedHash {
  hash: Uint8Array<ArrayBuffer>;
  iterations: number;
  salt: Uint8Array<ArrayBuffer>;
}

/** `PASSWORD_ITERATIONS` from the environment, clamped to 10 000 … 100 000 (default 100 000). */
export function iterationsFromEnv(
  env: Pick<Env, "PASSWORD_ITERATIONS">
): number {
  const parsed = Number.parseInt(env.PASSWORD_ITERATIONS ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_PASSWORD_ITERATIONS;
  }
  return Math.min(
    MAX_PASSWORD_ITERATIONS,
    Math.max(MIN_PASSWORD_ITERATIONS, parsed)
  );
}

async function deriveKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
  length: number
): Promise<Uint8Array<ArrayBuffer>> {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { hash: "SHA-256", iterations, name: "PBKDF2", salt },
    material,
    length * BITS_PER_BYTE
  );
  return new Uint8Array(bits);
}

export async function hashPassword(
  password: string,
  options: HashPasswordOptions = {}
): Promise<string> {
  const iterations = options.iterations ?? DEFAULT_PASSWORD_ITERATIONS;
  if (
    !Number.isInteger(iterations) ||
    iterations < 1 ||
    iterations > MAX_PASSWORD_ITERATIONS
  ) {
    throw new RangeError(
      `PBKDF2 iterations must be a whole number between 1 and ${MAX_PASSWORD_ITERATIONS}.`
    );
  }
  const salt = options.salt ?? randomBytes(PASSWORD_SALT_BYTES);
  const key = await deriveKey(password, salt, iterations, PASSWORD_KEY_BYTES);
  return [
    SCHEME,
    String(iterations),
    base64UrlEncode(salt),
    base64UrlEncode(key),
  ].join("$");
}

function parseStoredHash(stored: string): ParsedHash | null {
  const parts = stored.split("$");
  if (parts.length !== STORED_PARTS || parts[0] !== SCHEME) {
    return null;
  }
  const [, iterationText, saltText, hashText] = parts;
  if (!DIGITS_ONLY.test(iterationText)) {
    return null;
  }
  const iterations = Number(iterationText);
  if (iterations < 1 || iterations > MAX_PASSWORD_ITERATIONS) {
    return null;
  }
  const salt = base64UrlDecode(saltText);
  const hash = base64UrlDecode(hashText);
  if (
    !(salt && hash) ||
    salt.length < MIN_STORED_SALT_BYTES ||
    salt.length > MAX_STORED_BYTES ||
    hash.length < MIN_STORED_KEY_BYTES ||
    hash.length > MAX_STORED_BYTES
  ) {
    return null;
  }
  return { hash, iterations, salt };
}

/**
 * Checks `password` against a stored hash in constant time. NEVER throws: a malformed,
 * truncated or unverifiable `stored` value is simply `ok: false`.
 *
 * `targetIterations` is what new hashes use today; a correct password against a weaker
 * (or oddly shaped) hash reports `needsRehash` so the caller can upgrade it.
 */
export async function verifyPassword(
  password: string,
  stored: string,
  targetIterations: number = DEFAULT_PASSWORD_ITERATIONS
): Promise<PasswordCheck> {
  const parsed = parseStoredHash(stored);
  if (!parsed) {
    return { needsRehash: false, ok: false };
  }
  try {
    const actual = await deriveKey(
      password,
      parsed.salt,
      parsed.iterations,
      parsed.hash.length
    );
    if (!timingSafeEqualBytes(actual, parsed.hash)) {
      return { needsRehash: false, ok: false };
    }
  } catch {
    return { needsRehash: false, ok: false };
  }
  const needsRehash =
    parsed.iterations < targetIterations ||
    parsed.salt.length !== PASSWORD_SALT_BYTES ||
    parsed.hash.length !== PASSWORD_KEY_BYTES;
  return { needsRehash, ok: true };
}

// ─── Temporary passwords ────────────────────────────────────────────────────

/** No 0/O/o, 1/l/I/i: a temporary password is read aloud and typed by hand. */
const TEMP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
const TEMP_PASSWORD_LENGTH = 16;
const BYTE_RANGE = 256;
/** Bytes at or above this would bias the modulo, so they are skipped. */
const UNBIASED_LIMIT =
  Math.floor(BYTE_RANGE / TEMP_ALPHABET.length) * TEMP_ALPHABET.length;
const HAS_LOWER = /[a-z]/;
const HAS_UPPER = /[A-Z]/;
const HAS_DIGIT = /\d/;

function randomAlphabetString(length: number): string {
  let result = "";
  while (result.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < UNBIASED_LIMIT && result.length < length) {
        result += TEMP_ALPHABET.charAt(byte % TEMP_ALPHABET.length);
      }
    }
  }
  return result;
}

function mixesCharacterClasses(text: string): boolean {
  return HAS_LOWER.test(text) && HAS_UPPER.test(text) && HAS_DIGIT.test(text);
}

/**
 * A 16-character temporary password (admin-created accounts, password resets). Crypto-random,
 * unbiased, always contains a lower-case letter, an upper-case letter and a digit, and always
 * satisfies `passwordSchema` (10–128 characters).
 */
export function generateTemporaryPassword(): string {
  let candidate = randomAlphabetString(TEMP_PASSWORD_LENGTH);
  while (!mixesCharacterClasses(candidate)) {
    candidate = randomAlphabetString(TEMP_PASSWORD_LENGTH);
  }
  return candidate;
}
