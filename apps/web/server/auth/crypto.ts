/**
 * Small WebCrypto helpers (Workers + Node + browser safe): base64url, SHA-256,
 * random tokens and a constant-time comparison. No `node:*` imports.
 */

const encoder = new TextEncoder();

const BASE64URL_ONLY = /^[A-Za-z0-9_-]*$/;
const TRAILING_PADDING = /[=]+$/;
const BASE64_BLOCK = 4;
const HEX_RADIX = 16;
const HEX_WIDTH = 2;

/** 32 random bytes = 256 bits: the size of a session token. */
export const DEFAULT_TOKEN_BYTES = 32;

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(TRAILING_PADDING, "");
}

/** Decodes unpadded (or padded) base64url. Returns `null` for anything that is not valid. */
export function base64UrlDecode(text: string): Uint8Array<ArrayBuffer> | null {
  const trimmed = text.replace(TRAILING_PADDING, "");
  if (!BASE64URL_ONLY.test(trimmed) || trimmed.length % BASE64_BLOCK === 1) {
    return null;
  }
  const standard = trimmed.replaceAll("-", "+").replaceAll("_", "/");
  const padded = standard.padEnd(
    Math.ceil(standard.length / BASE64_BLOCK) * BASE64_BLOCK,
    "="
  );
  try {
    return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) =>
    byte.toString(HEX_RADIX).padStart(HEX_WIDTH, "0")
  ).join("");
}

/** Lower-case hex SHA-256 of the UTF-8 bytes of `text`. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return toHex(new Uint8Array(digest));
}

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** A random URL-safe token (default 32 bytes → 43 characters). */
export function randomToken(bytes: number = DEFAULT_TOKEN_BYTES): string {
  return base64UrlEncode(randomBytes(bytes));
}

/**
 * Compares two byte arrays without returning early on the first difference.
 * Differing lengths count as a mismatch but still walk the longer input.
 */
export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  const length = Math.max(a.length, b.length);
  let mismatch = Math.abs(a.length - b.length);
  for (let index = 0; index < length; index += 1) {
    mismatch += Math.abs((a[index] ?? 0) - (b[index] ?? 0));
  }
  return mismatch === 0;
}

/** Constant-time string comparison (compares the UTF-8 bytes). */
export function timingSafeEqual(a: string, b: string): boolean {
  return timingSafeEqualBytes(encoder.encode(a), encoder.encode(b));
}
