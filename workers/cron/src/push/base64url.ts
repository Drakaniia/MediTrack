const BASE64_PADDING = /[=]+$/;
const BASE64URL_ALPHABET = /^[A-Za-z0-9_-]*$/;
const PLUS = /\+/g;
const SLASH = /\//g;
const DASH = /-/g;
const UNDERSCORE = /_/g;
const BASE64_GROUP = 4;

/**
 * Encodes bytes as unpadded URL-safe base64 (RFC 4648 §5), the format Web Push
 * uses for VAPID keys, JWT segments and the subscription `p256dh`/`auth` values.
 * Built on `btoa` because it exists in both Workers and Node 24, unlike `Buffer`.
 */
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(PLUS, "-")
    .replace(SLASH, "_")
    .replace(BASE64_PADDING, "");
}

/**
 * Decodes URL-safe base64 (padding optional) to bytes. Throws on characters
 * outside the alphabet instead of silently producing garbage: a corrupt
 * subscription key must fail loudly rather than yield an undecryptable push.
 */
export function base64UrlDecode(text: string): Uint8Array<ArrayBuffer> {
  const unpadded = text.replace(BASE64_PADDING, "");
  if (
    !BASE64URL_ALPHABET.test(unpadded) ||
    unpadded.length % BASE64_GROUP === 1
  ) {
    throw new Error("Invalid base64url string");
  }
  const standard = unpadded.replace(DASH, "+").replace(UNDERSCORE, "/");
  const padded = standard.padEnd(
    Math.ceil(standard.length / BASE64_GROUP) * BASE64_GROUP,
    "="
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
