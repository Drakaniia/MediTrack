import { base64UrlDecode, base64UrlEncode } from "./base64url";

/** RFC 8291 §4: 4096-byte body minus 86-byte header, 1 padding byte, 16-byte GCM tag. */
export const MAX_PLAINTEXT_BYTES = 3993;
export const DEFAULT_RECORD_SIZE = 4096;

const SALT_LENGTH = 16;
const AUTH_SECRET_LENGTH = 16;
const PUBLIC_KEY_LENGTH = 65;
const COORDINATE_LENGTH = 32;
const UNCOMPRESSED_POINT_PREFIX = 0x04;
const RECORD_SIZE_LENGTH = 4;
const AES_GCM_TAG_LENGTH = 16;
const PADDING_DELIMITER_LENGTH = 1;
/** Last (and only) record is delimited by 0x02, RFC 8188 §2. */
const FINAL_RECORD_DELIMITER = 0x02;
const CEK_LENGTH_BYTES = 16;
const NONCE_LENGTH_BYTES = 12;
const IKM_LENGTH_BITS = 256;
const BITS_PER_BYTE = 8;
const HEADER_FIXED_LENGTH = SALT_LENGTH + RECORD_SIZE_LENGTH + 1;

const textEncoder = new TextEncoder();
const KEY_INFO_PREFIX = textEncoder.encode("WebPush: info\0");
const CEK_INFO = textEncoder.encode("Content-Encoding: aes128gcm\0");
const NONCE_INFO = textEncoder.encode("Content-Encoding: nonce\0");

/**
 * Thrown when the plaintext cannot fit one record of a 4096-byte push body.
 * Typed so callers can shorten the notification instead of treating it as a
 * generic crypto failure.
 */
export class PayloadTooLargeError extends Error {
  readonly byteLength: number;
  readonly maxBytes: number;

  constructor(byteLength: number, maxBytes: number = MAX_PLAINTEXT_BYTES) {
    super(
      `Push payload is ${byteLength} bytes; the limit is ${maxBytes} bytes`
    );
    this.name = "PayloadTooLargeError";
    this.byteLength = byteLength;
    this.maxBytes = maxBytes;
  }
}

/** The browser-provided half of a push subscription, both base64url. */
export interface EncryptionSubscription {
  /** 16-byte authentication secret of the user agent. */
  auth: string;
  /** 65-byte uncompressed P-256 public key of the user agent. */
  p256dh: string;
}

/**
 * Raw ephemeral sender key pair. Only exists so tests can replay the RFC 8291
 * Appendix A vector; production calls omit it and get a fresh key per message.
 */
export interface RawEphemeralKeyPair {
  /** 32-byte scalar. */
  privateKey: Uint8Array;
  /** 65-byte uncompressed point. */
  publicKey: Uint8Array;
}

export interface EncryptPayloadOptions {
  /** Test-only: sender key pair. Defaults to a freshly generated one. */
  ephemeralKeyPair?: RawEphemeralKeyPair;
  payload: Uint8Array;
  /** Record size written to the header. Defaults to 4096. */
  recordSize?: number;
  /** Test-only: 16-byte salt. Defaults to random bytes. */
  salt?: Uint8Array;
  subscription: EncryptionSubscription;
}

interface SenderKey {
  privateKey: CryptoKey;
  publicRaw: Uint8Array<ArrayBuffer>;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function assertUncompressedPoint(point: Uint8Array, label: string): void {
  if (
    point.length !== PUBLIC_KEY_LENGTH ||
    point[0] !== UNCOMPRESSED_POINT_PREFIX
  ) {
    throw new Error(`${label} must be a 65-byte uncompressed P-256 point`);
  }
}

async function loadSenderKey(
  provided: RawEphemeralKeyPair | undefined
): Promise<SenderKey> {
  if (!provided) {
    const pair = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"]
    );
    const publicRaw = new Uint8Array(
      await crypto.subtle.exportKey("raw", pair.publicKey)
    );
    return { privateKey: pair.privateKey, publicRaw };
  }
  assertUncompressedPoint(provided.publicKey, "Ephemeral public key");
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    {
      crv: "P-256",
      d: base64UrlEncode(provided.privateKey),
      ext: true,
      kty: "EC",
      x: base64UrlEncode(provided.publicKey.subarray(1, 1 + COORDINATE_LENGTH)),
      y: base64UrlEncode(provided.publicKey.subarray(1 + COORDINATE_LENGTH)),
    },
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"]
  );
  return { privateKey, publicRaw: new Uint8Array(provided.publicKey) };
}

async function hkdf(
  secret: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  lengthBytes: number
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", secret, "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { hash: "SHA-256", info, name: "HKDF", salt },
    key,
    lengthBytes * BITS_PER_BYTE
  );
  return new Uint8Array(bits);
}

function buildHeader(
  salt: Uint8Array,
  recordSize: number,
  senderPublic: Uint8Array
): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(HEADER_FIXED_LENGTH + senderPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(SALT_LENGTH, recordSize);
  header[SALT_LENGTH + RECORD_SIZE_LENGTH] = senderPublic.length;
  header.set(senderPublic, HEADER_FIXED_LENGTH);
  return header;
}

function resolveSalt(salt: Uint8Array | undefined): Uint8Array<ArrayBuffer> {
  if (!salt) {
    return crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  }
  if (salt.length !== SALT_LENGTH) {
    throw new Error("Salt must be 16 bytes");
  }
  return new Uint8Array(salt);
}

function resolveRecordSize(
  recordSize: number | undefined,
  plaintextLength: number
): number {
  const size = recordSize ?? DEFAULT_RECORD_SIZE;
  const minimum =
    plaintextLength + PADDING_DELIMITER_LENGTH + AES_GCM_TAG_LENGTH;
  // RFC 8291 §4: rs must be strictly greater than the encrypted record.
  if (!Number.isInteger(size) || size <= minimum) {
    throw new RangeError(
      `Record size must be an integer greater than ${minimum}`
    );
  }
  return size;
}

/**
 * Encrypts a push payload for one subscription using RFC 8291 (`aes128gcm`).
 *
 * The result is the full request body: RFC 8188 header (salt, record size, key
 * id = sender public key) followed by a single AES-128-GCM record. A single
 * record with the `0x02` delimiter is what RFC 8291 §4 mandates, and keeping
 * the plaintext within {@link MAX_PLAINTEXT_BYTES} keeps the body inside the
 * 4096 bytes every push service must accept.
 *
 * @throws PayloadTooLargeError when the payload exceeds {@link MAX_PLAINTEXT_BYTES}.
 */
export async function encryptPayload(
  options: EncryptPayloadOptions
): Promise<Uint8Array<ArrayBuffer>> {
  const { payload, subscription } = options;
  if (payload.length > MAX_PLAINTEXT_BYTES) {
    throw new PayloadTooLargeError(payload.length);
  }
  const receiverPublic = base64UrlDecode(subscription.p256dh);
  assertUncompressedPoint(receiverPublic, "Subscription p256dh");
  const authSecret = base64UrlDecode(subscription.auth);
  if (authSecret.length !== AUTH_SECRET_LENGTH) {
    throw new Error("Subscription auth secret must be 16 bytes");
  }
  const salt = resolveSalt(options.salt);
  const recordSize = resolveRecordSize(options.recordSize, payload.length);

  const sender = await loadSenderKey(options.ephemeralKeyPair);
  const receiverKey = await crypto.subtle.importKey(
    "raw",
    receiverPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: receiverKey },
      sender.privateKey,
      IKM_LENGTH_BITS
    )
  );

  const keyInfo = concatBytes(
    KEY_INFO_PREFIX,
    receiverPublic,
    sender.publicRaw
  );
  const ikm = await hkdf(
    sharedSecret,
    authSecret,
    keyInfo,
    IKM_LENGTH_BITS / BITS_PER_BYTE
  );
  const contentKey = await hkdf(ikm, salt, CEK_INFO, CEK_LENGTH_BYTES);
  const nonce = await hkdf(ikm, salt, NONCE_INFO, NONCE_LENGTH_BYTES);

  const aesKey = await crypto.subtle.importKey(
    "raw",
    contentKey,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );
  const record = concatBytes(payload, new Uint8Array([FINAL_RECORD_DELIMITER]));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ iv: nonce, name: "AES-GCM" }, aesKey, record)
  );
  return concatBytes(
    buildHeader(salt, recordSize, sender.publicRaw),
    ciphertext
  );
}
