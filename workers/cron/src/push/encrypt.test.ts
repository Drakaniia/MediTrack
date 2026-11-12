import { describe, expect, it } from "vitest";
import { base64UrlDecode, base64UrlEncode } from "./base64url";
import {
  encryptPayload,
  MAX_PLAINTEXT_BYTES,
  PayloadTooLargeError,
} from "./encrypt";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// RFC 8291 §5 and Appendix A worked example.
const RFC_PLAINTEXT = "When I grow up, I want to be a watermelon";
const RFC_AUTH_SECRET = "BTBZMqHH6r4Tts7J_aSIgg";
const RFC_RECEIVER_PUBLIC =
  "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
const RFC_RECEIVER_PRIVATE = "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94";
const RFC_SENDER_PUBLIC =
  "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
const RFC_SENDER_PRIVATE = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw";
const RFC_SALT = "DGv6ra1nlYgDCS1FRnbzlw";
// The pushed body exactly as printed in RFC 8291 §5. Note the Appendix A ciphertext
// differs from this; §5 is the one that decrypts correctly (see the decrypt test).
const RFC_BODY =
  "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml" +
  "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
  "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN";

const HEADER_LENGTH = 86;
const GCM_TAG_LENGTH = 16;

async function importReceiverPrivateKey(
  publicKey: string,
  privateKey: string
): Promise<CryptoKey> {
  const point = base64UrlDecode(publicKey);
  return await crypto.subtle.importKey(
    "jwk",
    {
      crv: "P-256",
      d: privateKey,
      ext: true,
      kty: "EC",
      x: base64UrlEncode(point.subarray(1, 33)),
      y: base64UrlEncode(point.subarray(33)),
    },
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"]
  );
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
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { hash: "SHA-256", info, name: "HKDF", salt },
      key,
      lengthBytes * 8
    )
  );
}

/** Independent decrypt implementation (the receiver side of RFC 8291 §3.4). */
async function decryptBody(
  body: Uint8Array<ArrayBuffer>,
  receiver: { publicKey: string; privateKey: string; auth: string }
): Promise<Uint8Array<ArrayBuffer>> {
  const salt = body.slice(0, 16);
  const recordSize = new DataView(body.buffer).getUint32(16);
  const keyIdLength = body.at(20);
  const senderPublic = body.slice(21, 21 + (keyIdLength ?? 0));
  const ciphertext = body.slice(21 + (keyIdLength ?? 0));
  expect(recordSize).toBe(4096);
  expect(keyIdLength).toBe(65);

  const privateKey = await importReceiverPrivateKey(
    receiver.publicKey,
    receiver.privateKey
  );
  const senderKey = await crypto.subtle.importKey(
    "raw",
    senderPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: senderKey },
      privateKey,
      256
    )
  );
  const keyInfo = new Uint8Array([
    ...encoder.encode("WebPush: info\0"),
    ...base64UrlDecode(receiver.publicKey),
    ...senderPublic,
  ]);
  const ikm = await hkdf(shared, base64UrlDecode(receiver.auth), keyInfo, 32);
  const cek = await hkdf(
    ikm,
    salt,
    encoder.encode("Content-Encoding: aes128gcm\0"),
    16
  );
  const nonce = await hkdf(
    ikm,
    salt,
    encoder.encode("Content-Encoding: nonce\0"),
    12
  );
  const aesKey = await crypto.subtle.importKey(
    "raw",
    cek,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );
  const padded = new Uint8Array(
    await crypto.subtle.decrypt(
      { iv: nonce, name: "AES-GCM" },
      aesKey,
      ciphertext
    )
  );
  const delimiterAt = padded.lastIndexOf(0x02);
  expect(delimiterAt).toBe(padded.length - 1);
  return padded.slice(0, delimiterAt);
}

async function newReceiver(): Promise<{
  publicKey: string;
  privateKey: string;
  auth: string;
}> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  const publicKey = base64UrlEncode(
    new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))
  );
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const auth = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));
  return { auth, privateKey: jwk.d ?? "", publicKey };
}

describe("encryptPayload RFC 8291 vector", () => {
  it("reproduces the Appendix A worked example byte for byte", async () => {
    const body = await encryptPayload({
      ephemeralKeyPair: {
        privateKey: base64UrlDecode(RFC_SENDER_PRIVATE),
        publicKey: base64UrlDecode(RFC_SENDER_PUBLIC),
      },
      payload: encoder.encode(RFC_PLAINTEXT),
      salt: base64UrlDecode(RFC_SALT),
      subscription: { auth: RFC_AUTH_SECRET, p256dh: RFC_RECEIVER_PUBLIC },
    });
    // 86-byte header + 41-byte plaintext + delimiter + 16-byte tag. (The RFC's printed
    // "Content-Length: 145" is a typo; its own base64url body decodes to 144 bytes.)
    expect(body).toHaveLength(144);
    expect(base64UrlEncode(body)).toBe(RFC_BODY);
  });

  it("decrypts the RFC example body with the receiver private key", async () => {
    const plaintext = await decryptBody(base64UrlDecode(RFC_BODY), {
      auth: RFC_AUTH_SECRET,
      privateKey: RFC_RECEIVER_PRIVATE,
      publicKey: RFC_RECEIVER_PUBLIC,
    });
    expect(decoder.decode(plaintext)).toBe(RFC_PLAINTEXT);
  });
});

describe("encryptPayload round trip", () => {
  it("decrypts with the receiver private key when salt and key are random", async () => {
    const receiver = await newReceiver();
    const message = JSON.stringify({ body: "Ünïcode ✓", title: "Urgent" });
    const body = await encryptPayload({
      payload: encoder.encode(message),
      subscription: { auth: receiver.auth, p256dh: receiver.publicKey },
    });
    expect(await decryptBody(body, receiver)).toEqual(encoder.encode(message));
  });

  it("writes the RFC 8188 header: salt, record size, key id length, sender key", async () => {
    const receiver = await newReceiver();
    const payload = encoder.encode("hello");
    const body = await encryptPayload({
      payload,
      subscription: { auth: receiver.auth, p256dh: receiver.publicKey },
    });
    expect(body).toHaveLength(
      HEADER_LENGTH + payload.length + 1 + GCM_TAG_LENGTH
    );
    expect(new DataView(body.buffer).getUint32(16)).toBe(4096);
    expect(body[20]).toBe(65);
    expect(body[21]).toBe(0x04);
  });

  it("uses a different salt and sender key for every message", async () => {
    const receiver = await newReceiver();
    const options = {
      payload: encoder.encode("same"),
      subscription: { auth: receiver.auth, p256dh: receiver.publicKey },
    };
    const first = await encryptPayload(options);
    const second = await encryptPayload(options);
    expect(first.slice(0, 16)).not.toEqual(second.slice(0, 16));
    expect(first.slice(21, 86)).not.toEqual(second.slice(21, 86));
  });

  it("encrypts an empty payload", async () => {
    const receiver = await newReceiver();
    const body = await encryptPayload({
      payload: new Uint8Array(),
      subscription: { auth: receiver.auth, p256dh: receiver.publicKey },
    });
    expect(await decryptBody(body, receiver)).toHaveLength(0);
  });
});

describe("encryptPayload limits and validation", () => {
  it("accepts exactly the maximum plaintext and keeps the body within 4096 bytes", async () => {
    const receiver = await newReceiver();
    const body = await encryptPayload({
      payload: new Uint8Array(MAX_PLAINTEXT_BYTES).fill(0x61),
      subscription: { auth: receiver.auth, p256dh: receiver.publicKey },
    });
    expect(body).toHaveLength(4096);
  });

  it("throws PayloadTooLargeError one byte over the limit", async () => {
    const receiver = await newReceiver();
    const attempt = encryptPayload({
      payload: new Uint8Array(MAX_PLAINTEXT_BYTES + 1),
      subscription: { auth: receiver.auth, p256dh: receiver.publicKey },
    });
    await expect(attempt).rejects.toBeInstanceOf(PayloadTooLargeError);
    await expect(attempt).rejects.toMatchObject({
      byteLength: MAX_PLAINTEXT_BYTES + 1,
      maxBytes: MAX_PLAINTEXT_BYTES,
    });
  });

  it("rejects a malformed p256dh key", async () => {
    await expect(
      encryptPayload({
        payload: encoder.encode("x"),
        subscription: {
          auth: RFC_AUTH_SECRET,
          p256dh: base64UrlEncode(new Uint8Array(65)),
        },
      })
    ).rejects.toThrow("uncompressed");
  });

  it("rejects an auth secret of the wrong length", async () => {
    const receiver = await newReceiver();
    await expect(
      encryptPayload({
        payload: encoder.encode("x"),
        subscription: {
          auth: base64UrlEncode(new Uint8Array(8)),
          p256dh: receiver.publicKey,
        },
      })
    ).rejects.toThrow("16 bytes");
  });

  it("rejects a salt of the wrong length and a too-small record size", async () => {
    const receiver = await newReceiver();
    const subscription = { auth: receiver.auth, p256dh: receiver.publicKey };
    await expect(
      encryptPayload({
        payload: encoder.encode("x"),
        salt: new Uint8Array(8),
        subscription,
      })
    ).rejects.toThrow("Salt");
    await expect(
      encryptPayload({
        payload: encoder.encode("x"),
        recordSize: 18,
        subscription,
      })
    ).rejects.toThrow(RangeError);
  });
});
