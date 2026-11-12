import { describe, expect, it } from "vitest";
import { base64UrlDecode, base64UrlEncode } from "./base64url";
import {
  createVapidHeaders,
  generateVapidKeyPair,
  MAX_VAPID_LIFETIME_SECONDS,
  pushServiceAudience,
} from "./vapid";

const NOW_MS = Date.UTC(2026, 10, 12, 8, 0, 0);
const NOW_SECONDS = NOW_MS / 1000;
const AUDIENCE = "https://fcm.googleapis.com";
const SUBJECT = "mailto:ops@example.org";
const AUTH_PATTERN = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/;

const decoder = new TextDecoder();

function parseJson(segment: string): Record<string, unknown> {
  return JSON.parse(decoder.decode(base64UrlDecode(segment)));
}

function splitHeader(authorization: string): {
  header: string;
  claims: string;
  signature: string;
  key: string;
} {
  const match = AUTH_PATTERN.exec(authorization);
  if (!match) {
    throw new Error(`Unexpected authorization header: ${authorization}`);
  }
  const [, header = "", claims = "", signature = "", key = ""] = match;
  return { claims, header, key, signature };
}

async function sign(expiresInSeconds?: number): Promise<{
  authorization: string;
  publicKey: string;
}> {
  const { publicKey, privateKey } = await generateVapidKeyPair();
  const { authorization } = await createVapidHeaders({
    audience: AUDIENCE,
    expiresInSeconds,
    now: NOW_MS,
    privateKey,
    publicKey,
    subject: SUBJECT,
  });
  return { authorization, publicKey };
}

describe("generateVapidKeyPair", () => {
  it("returns a 65-byte uncompressed public key and a 32-byte private scalar", async () => {
    const { publicKey, privateKey } = await generateVapidKeyPair();
    const point = base64UrlDecode(publicKey);
    expect(point).toHaveLength(65);
    expect(point[0]).toBe(0x04);
    expect(base64UrlDecode(privateKey)).toHaveLength(32);
  });

  it("generates a different pair every time", async () => {
    const first = await generateVapidKeyPair();
    const second = await generateVapidKeyPair();
    expect(first.privateKey).not.toBe(second.privateKey);
  });
});

describe("createVapidHeaders", () => {
  it("produces an ES256 JWT whose signature verifies with the public key", async () => {
    const { authorization, publicKey } = await sign();
    const parts = splitHeader(authorization);
    const verifyKey = await crypto.subtle.importKey(
      "raw",
      base64UrlDecode(publicKey),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
    const valid = await crypto.subtle.verify(
      { hash: "SHA-256", name: "ECDSA" },
      verifyKey,
      base64UrlDecode(parts.signature),
      new TextEncoder().encode(`${parts.header}.${parts.claims}`)
    );
    expect(valid).toBe(true);
    expect(base64UrlDecode(parts.signature)).toHaveLength(64);
    expect(parts.key).toBe(publicKey);
  });

  it("does not verify against a different key", async () => {
    const { authorization } = await sign();
    const parts = splitHeader(authorization);
    const other = await generateVapidKeyPair();
    const verifyKey = await crypto.subtle.importKey(
      "raw",
      base64UrlDecode(other.publicKey),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
    const valid = await crypto.subtle.verify(
      { hash: "SHA-256", name: "ECDSA" },
      verifyKey,
      base64UrlDecode(parts.signature),
      new TextEncoder().encode(`${parts.header}.${parts.claims}`)
    );
    expect(valid).toBe(false);
  });

  it("sets the JWT header and the aud, sub and exp claims", async () => {
    const { authorization } = await sign(3600);
    const parts = splitHeader(authorization);
    expect(parseJson(parts.header)).toEqual({ alg: "ES256", typ: "JWT" });
    expect(parseJson(parts.claims)).toEqual({
      aud: AUDIENCE,
      exp: NOW_SECONDS + 3600,
      sub: SUBJECT,
    });
  });

  it("defaults to a lifetime under 24 hours", async () => {
    const { authorization } = await sign();
    const { exp } = parseJson(splitHeader(authorization).claims);
    expect(exp).toBe(NOW_SECONDS + 12 * 3600);
  });

  it("caps exp at 24 hours even when more is requested", async () => {
    const { authorization } = await sign(7 * 24 * 3600);
    const { exp } = parseJson(splitHeader(authorization).claims);
    expect(exp).toBe(NOW_SECONDS + MAX_VAPID_LIFETIME_SECONDS);
  });

  it("rejects a non-positive lifetime", async () => {
    const { publicKey, privateKey } = await generateVapidKeyPair();
    await expect(
      createVapidHeaders({
        audience: AUDIENCE,
        expiresInSeconds: 0,
        now: NOW_MS,
        privateKey,
        publicKey,
        subject: SUBJECT,
      })
    ).rejects.toThrow(RangeError);
  });

  it("accepts an https subject and rejects anything else", async () => {
    const { publicKey, privateKey } = await generateVapidKeyPair();
    const base = { audience: AUDIENCE, now: NOW_MS, privateKey, publicKey };
    await expect(
      createVapidHeaders({ ...base, subject: "https://example.org/contact" })
    ).resolves.toHaveProperty("authorization");
    await expect(
      createVapidHeaders({ ...base, subject: "ops@example.org" })
    ).rejects.toThrow("VAPID subject");
    await expect(
      createVapidHeaders({ ...base, subject: "http://example.org" })
    ).rejects.toThrow("VAPID subject");
  });

  it("rejects malformed keys", async () => {
    const { publicKey, privateKey } = await generateVapidKeyPair();
    const base = { audience: AUDIENCE, now: NOW_MS, subject: SUBJECT };
    await expect(
      createVapidHeaders({
        ...base,
        privateKey,
        publicKey: base64UrlEncode(new Uint8Array(33)),
      })
    ).rejects.toThrow("65-byte");
    await expect(
      createVapidHeaders({
        ...base,
        privateKey: base64UrlEncode(new Uint8Array(31)),
        publicKey,
      })
    ).rejects.toThrow("32-byte");
  });
});

describe("pushServiceAudience", () => {
  it("returns the origin of the endpoint", () => {
    expect(
      pushServiceAudience("https://fcm.googleapis.com/fcm/send/abc123?x=1")
    ).toBe("https://fcm.googleapis.com");
    expect(pushServiceAudience("https://web.push.apple.com:443/xyz")).toBe(
      "https://web.push.apple.com"
    );
  });

  it("rejects non-https endpoints", () => {
    expect(() => pushServiceAudience("http://push.example/abc")).toThrow(
      "https"
    );
  });
});
