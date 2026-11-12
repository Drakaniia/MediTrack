import { describe, expect, it } from "vitest";

import {
  bufferToBase64Url,
  describeUserAgent,
  detectPushState,
  isIosDevice,
  type PushEnvironment,
  type SubscriptionLike,
  serializeSubscription,
  urlBase64ToUint8Array,
} from "./push-client";

const READY: PushEnvironment = {
  hasNotification: true,
  hasPushManager: true,
  hasServiceWorker: true,
  isIos: false,
  isSecureContext: true,
  isStandalone: false,
  permission: "default",
};

describe("urlBase64ToUint8Array", () => {
  it("decodes base64url with and without padding", () => {
    // "hello?>" → aGVsbG8_Pg (url-safe: '_' for '/')
    expect([...urlBase64ToUint8Array("aGVsbG8_Pg")]).toEqual([
      104, 101, 108, 108, 111, 63, 62,
    ]);
    expect([...urlBase64ToUint8Array("-_8")]).toEqual([251, 255]);
  });

  it("decodes a 65-byte VAPID key", () => {
    const key = Buffer.alloc(65, 9).toString("base64url");
    const bytes = urlBase64ToUint8Array(key);
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(9);
  });
});

describe("bufferToBase64Url", () => {
  it("round-trips and strips padding", () => {
    const bytes = Uint8Array.from([251, 255, 1]);
    const text = bufferToBase64Url(bytes.buffer);
    expect(text).toBe("-_8B");
    expect([...urlBase64ToUint8Array(text ?? "")]).toEqual([251, 255, 1]);
    expect(bufferToBase64Url(Uint8Array.from([1]).buffer)).toBe("AQ");
    expect(bufferToBase64Url(null)).toBeNull();
  });
});

describe("serializeSubscription", () => {
  it("uses toJSON() and adds the user agent", () => {
    const subscription: SubscriptionLike = {
      toJSON: () => ({
        endpoint: "https://push.example.test/abc",
        keys: { auth: "AUTH", p256dh: "P256" },
      }),
    };
    expect(serializeSubscription(subscription, "Firefox")).toEqual({
      endpoint: "https://push.example.test/abc",
      keys: { auth: "AUTH", p256dh: "P256" },
      userAgent: "Firefox",
    });
    expect(serializeSubscription(subscription)).not.toHaveProperty("userAgent");
  });

  it("falls back to getKey() when the JSON has no keys", () => {
    const subscription: SubscriptionLike = {
      getKey: (name) =>
        name === "p256dh"
          ? Uint8Array.from([251, 255]).buffer
          : Uint8Array.from([1]).buffer,
      toJSON: () => ({ endpoint: "https://push.example.test/abc" }),
    };
    expect(serializeSubscription(subscription)?.keys).toEqual({
      auth: "AQ",
      p256dh: "-_8",
    });
  });

  it("returns null when something is missing", () => {
    expect(
      serializeSubscription({
        toJSON: () => ({ keys: { auth: "a", p256dh: "p" } }),
      })
    ).toBeNull();
    expect(
      serializeSubscription({
        toJSON: () => ({ endpoint: "https://x.test/a" }),
      })
    ).toBeNull();
  });
});

describe("detectPushState", () => {
  it("reports the browser's permission when everything is supported", () => {
    expect(detectPushState(READY)).toBe("default");
    expect(detectPushState({ ...READY, permission: "granted" })).toBe(
      "granted"
    );
    expect(detectPushState({ ...READY, permission: "denied" })).toBe("denied");
  });

  it("needs HTTPS before anything else", () => {
    expect(
      detectPushState({ ...READY, isIos: true, isSecureContext: false })
    ).toBe("insecure");
  });

  it("asks iOS users to install to the Home Screen first", () => {
    expect(
      detectPushState({ ...READY, hasPushManager: false, isIos: true })
    ).toBe("needs-install");
    expect(detectPushState({ ...READY, isIos: true, isStandalone: true })).toBe(
      "default"
    );
  });

  it("is unsupported when an API is missing", () => {
    for (const missing of [
      "hasNotification",
      "hasPushManager",
      "hasServiceWorker",
    ] as const) {
      expect(
        detectPushState({
          ...READY,
          [missing]: false,
          permission: missing === "hasNotification" ? null : "default",
        })
      ).toBe("unsupported");
    }
  });
});

describe("isIosDevice", () => {
  it("recognises iPhone, iPad and iPadOS-as-Mac", () => {
    expect(
      isIosDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)", "iPhone", 5)
    ).toBe(true);
    expect(isIosDevice("Mozilla/5.0 (Macintosh)", "MacIntel", 5)).toBe(true);
    expect(isIosDevice("Mozilla/5.0 (Macintosh)", "MacIntel", 0)).toBe(false);
    expect(isIosDevice("Mozilla/5.0 (Windows NT 10.0)", "Win32", 0)).toBe(
      false
    );
  });
});

describe("describeUserAgent", () => {
  it("summarises browser and system", () => {
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36"
      )
    ).toBe("Chrome on Windows");
    expect(
      describeUserAgent("Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Edg/130.0")
    ).toBe("Edge on Windows");
    expect(
      describeUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1"
      )
    ).toBe("Safari on iPhone");
    expect(describeUserAgent(null)).toBe("Unknown device");
    expect(describeUserAgent("curl/8")).toBe("Unknown device");
  });
});
