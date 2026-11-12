import { base64UrlDecode, base64UrlEncode } from "./base64url";

const SECONDS_PER_HOUR = 3600;
const MS_PER_SECOND = 1000;
/** RFC 8292 §2: a push service MUST reject tokens that expire more than 24h ahead. */
export const MAX_VAPID_LIFETIME_SECONDS = 24 * SECONDS_PER_HOUR;
/** Default token lifetime; 12h leaves headroom for clock skew against the 24h cap. */
export const DEFAULT_VAPID_LIFETIME_SECONDS = 12 * SECONDS_PER_HOUR;

const UNCOMPRESSED_POINT_LENGTH = 65;
const UNCOMPRESSED_POINT_PREFIX = 0x04;
const COORDINATE_LENGTH = 32;
const SUBJECT_PATTERN = /^(?:mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/;

const textEncoder = new TextEncoder();

/** A VAPID key pair as the base64url strings that get stored in config/secrets. */
export interface VapidKeyPair {
  /** 32-byte P-256 scalar, base64url. */
  privateKey: string;
  /** 65-byte uncompressed P-256 point (`0x04 || X || Y`), base64url. */
  publicKey: string;
}

export interface VapidHeaderOptions {
  /** Origin of the push service, e.g. `https://fcm.googleapis.com`. */
  audience: string;
  /** Token lifetime; clamped to 24h as RFC 8292 requires. Defaults to 12h. */
  expiresInSeconds?: number;
  /** Current time in epoch milliseconds (injected so tests control the clock). */
  now: number;
  privateKey: string;
  publicKey: string;
  /** `mailto:` address or `https:` URL the push service can contact. */
  subject: string;
}

export interface VapidHeaders {
  authorization: string;
}

/**
 * Generates a fresh VAPID key pair. Done with WebCrypto and exported raw so the
 * public half can go straight into `PushManager.subscribe({ applicationServerKey })`
 * and the private half into a Worker secret.
 */
export async function generateVapidKeyPair(): Promise<VapidKeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const publicRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", keyPair.publicKey)
  );
  const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  if (!privateJwk.d) {
    throw new Error("Exported private key has no scalar");
  }
  return {
    privateKey: privateJwk.d,
    publicKey: base64UrlEncode(publicRaw),
  };
}

/**
 * Returns the origin of a push endpoint, which is the JWT `aud` claim.
 * Push services reject tokens whose audience differs from the endpoint origin.
 */
export function pushServiceAudience(endpoint: string): string {
  const url = new URL(endpoint);
  if (url.protocol !== "https:") {
    throw new Error("Push endpoint must use https");
  }
  return url.origin;
}

/**
 * Imports a raw VAPID key pair as a signing key. WebCrypto cannot import a bare
 * scalar, so the JWK is assembled from the public point (x, y) plus `d`.
 */
export async function importVapidSigningKey(
  publicKey: string,
  privateKey: string
): Promise<CryptoKey> {
  const point = base64UrlDecode(publicKey);
  const isUncompressed =
    point.length === UNCOMPRESSED_POINT_LENGTH &&
    point[0] === UNCOMPRESSED_POINT_PREFIX;
  if (!isUncompressed) {
    throw new Error(
      "VAPID public key must be a 65-byte uncompressed P-256 point"
    );
  }
  const scalar = base64UrlDecode(privateKey);
  if (scalar.length !== COORDINATE_LENGTH) {
    throw new Error("VAPID private key must be a 32-byte P-256 scalar");
  }
  return await crypto.subtle.importKey(
    "jwk",
    {
      crv: "P-256",
      d: privateKey,
      ext: true,
      kty: "EC",
      x: base64UrlEncode(point.subarray(1, 1 + COORDINATE_LENGTH)),
      y: base64UrlEncode(point.subarray(1 + COORDINATE_LENGTH)),
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
}

function jsonSegment(value: unknown): string {
  return base64UrlEncode(textEncoder.encode(JSON.stringify(value)));
}

/**
 * Builds the RFC 8292 `Authorization` header (`vapid t=<jwt>, k=<publicKey>`).
 * The JWT is signed ES256; WebCrypto already emits the raw `r || s` form JWS
 * wants, so no DER conversion is needed.
 */
export async function createVapidHeaders(
  options: VapidHeaderOptions
): Promise<VapidHeaders> {
  const { audience, subject, publicKey, privateKey, now } = options;
  if (!SUBJECT_PATTERN.test(subject)) {
    throw new Error("VAPID subject must be a mailto: address or https: URL");
  }
  const lifetime = Math.min(
    options.expiresInSeconds ?? DEFAULT_VAPID_LIFETIME_SECONDS,
    MAX_VAPID_LIFETIME_SECONDS
  );
  if (!(lifetime > 0)) {
    throw new RangeError("expiresInSeconds must be positive");
  }
  const signingKey = await importVapidSigningKey(publicKey, privateKey);
  const header = jsonSegment({ alg: "ES256", typ: "JWT" });
  const claims = jsonSegment({
    aud: audience,
    exp: Math.floor(now / MS_PER_SECOND) + Math.floor(lifetime),
    sub: subject,
  });
  const signingInput = `${header}.${claims}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { hash: "SHA-256", name: "ECDSA" },
      signingKey,
      textEncoder.encode(signingInput)
    )
  );
  return {
    authorization: `vapid t=${signingInput}.${base64UrlEncode(signature)}, k=${publicKey}`,
  };
}
