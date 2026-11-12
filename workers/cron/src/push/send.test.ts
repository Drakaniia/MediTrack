import { beforeAll, describe, expect, it } from "vitest";
import { base64UrlDecode, base64UrlEncode } from "./base64url";
import { MAX_PLAINTEXT_BYTES } from "./encrypt";
import {
  type PushNotificationPayload,
  type SendWebPushOptions,
  sendWebPush,
  serializePushPayload,
} from "./send";
import { generateVapidKeyPair } from "./vapid";

const ENDPOINT = "https://updates.push.services.mozilla.com/wpush/v2/abc123";
const NOW_MS = Date.UTC(2026, 10, 12, 8, 0, 0);
const SUBJECT = "mailto:ops@example.org";

interface RecordedCall {
  init: RequestInit;
  url: string;
}

type FakeResponder = () => Response | Promise<Response>;

function createFakeFetch(responder: FakeResponder): {
  fetch: typeof fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ init: init ?? {}, url: String(input) });
    return await responder();
  }) as typeof fetch;
  return { calls, fetch: fakeFetch };
}

function headersOf(
  call: RecordedCall | undefined
): Record<string, string | undefined> {
  return (call?.init.headers ?? {}) as Record<string, string | undefined>;
}

let baseOptions: Omit<SendWebPushOptions, "fetch">;

beforeAll(async () => {
  const receiver = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  const p256dh = base64UrlEncode(
    new Uint8Array(await crypto.subtle.exportKey("raw", receiver.publicKey))
  );
  const auth = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));
  const vapid = await generateVapidKeyPair();
  baseOptions = {
    now: () => NOW_MS,
    payload: serializePushPayload({
      body: "Check the fridge",
      title: "2 batches urgent",
      url: "/alerts",
    }),
    subscription: { auth, endpoint: ENDPOINT, p256dh },
    ttl: 3600,
    vapid: { ...vapid, subject: SUBJECT },
  };
});

async function sendWith(
  responder: FakeResponder,
  overrides: Partial<SendWebPushOptions> = {}
): Promise<{
  outcome: Awaited<ReturnType<typeof sendWebPush>>;
  calls: RecordedCall[];
}> {
  const { fetch: fakeFetch, calls } = createFakeFetch(responder);
  const outcome = await sendWebPush({
    ...baseOptions,
    ...overrides,
    fetch: fakeFetch,
  });
  return { calls, outcome };
}

describe("sendWebPush request", () => {
  it("posts an encrypted body to the endpoint with the required headers", async () => {
    const { outcome, calls } = await sendWith(
      () => new Response(null, { status: 201 })
    );
    expect(outcome).toEqual({ kind: "sent", status: 201 });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe(ENDPOINT);
    expect(call?.init.method).toBe("POST");
    const headers = headersOf(call);
    expect(headers.TTL).toBe("3600");
    expect(headers["Content-Encoding"]).toBe("aes128gcm");
    expect(headers["Content-Type"]).toBe("application/octet-stream");
    expect(headers.Authorization).toMatch(
      /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/
    );
    expect(headers.Authorization).toContain(`k=${baseOptions.vapid.publicKey}`);
    expect(headers.Urgency).toBeUndefined();
    expect(headers.Topic).toBeUndefined();
    const body = call?.init.body as Uint8Array;
    expect(body).toBeInstanceOf(Uint8Array);
    expect(body[20]).toBe(65);
  });

  it("scopes the VAPID audience to the push service origin and uses the injected clock", async () => {
    const { calls } = await sendWith(() => new Response(null, { status: 201 }));
    const token = /vapid t=([\w-]+)\.([\w-]+)\./.exec(
      headersOf(calls[0]).Authorization ?? ""
    );
    const claims = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(token?.[2] ?? ""))
    );
    expect(claims.aud).toBe("https://updates.push.services.mozilla.com");
    expect(claims.sub).toBe(SUBJECT);
    expect(claims.exp).toBeGreaterThan(NOW_MS / 1000);
    expect(claims.exp).toBeLessThanOrEqual(NOW_MS / 1000 + 86_400);
  });

  it("adds Urgency and Topic when provided", async () => {
    const { calls } = await sendWith(
      () => new Response(null, { status: 201 }),
      { topic: "expiry-alerts", urgency: "high" }
    );
    const headers = headersOf(calls[0]);
    expect(headers.Urgency).toBe("high");
    expect(headers.Topic).toBe("expiry-alerts");
  });

  it("sends an empty body without Content-Encoding for a null payload", async () => {
    const { outcome, calls } = await sendWith(
      () => new Response(null, { status: 201 }),
      { payload: null }
    );
    expect(outcome.kind).toBe("sent");
    const headers = headersOf(calls[0]);
    expect(calls[0]?.init.body).toBeNull();
    expect(headers["Content-Encoding"]).toBeUndefined();
    expect(headers["Content-Type"]).toBeUndefined();
    expect(headers.TTL).toBe("3600");
    expect(headers.Authorization).toBeDefined();
  });

  it("serialises the notification payload as JSON", () => {
    const payload: PushNotificationPayload = {
      body: "b",
      count: 3,
      severity: "critical",
      tag: "expiry",
      title: "t",
      url: "/x",
    };
    expect(JSON.parse(serializePushPayload(payload))).toEqual(payload);
  });
});

describe("sendWebPush outcomes", () => {
  it("treats any 2xx as sent", async () => {
    const { outcome } = await sendWith(
      () => new Response(null, { status: 202 })
    );
    expect(outcome).toEqual({ kind: "sent", status: 202 });
  });

  it("reports 404 and 410 as gone", async () => {
    for (const status of [404, 410]) {
      const { outcome } = await sendWith(() => new Response(null, { status }));
      expect(outcome).toEqual({ kind: "gone", status });
    }
  });

  it("reports 429 with a numeric Retry-After as retry", async () => {
    const { outcome } = await sendWith(
      () =>
        new Response(null, { headers: { "Retry-After": "120" }, status: 429 })
    );
    expect(outcome).toEqual({
      kind: "retry",
      retryAfterSeconds: 120,
      status: 429,
    });
  });

  it("converts an HTTP-date Retry-After relative to the injected clock", async () => {
    const retryAt = new Date(NOW_MS + 90_000).toUTCString();
    const { outcome } = await sendWith(
      () =>
        new Response(null, {
          headers: { "Retry-After": retryAt },
          status: 503,
        })
    );
    expect(outcome).toEqual({
      kind: "retry",
      retryAfterSeconds: 90,
      status: 503,
    });
  });

  it("reports 5xx without Retry-After as retry without a delay", async () => {
    const { outcome } = await sendWith(
      () => new Response(null, { status: 502 })
    );
    expect(outcome).toEqual({ kind: "retry", status: 502 });
  });

  it("ignores an unparseable Retry-After", async () => {
    const { outcome } = await sendWith(
      () =>
        new Response(null, {
          headers: { "Retry-After": "soon" },
          status: 500,
        })
    );
    expect(outcome).toEqual({ kind: "retry", status: 500 });
  });

  it("reports a network error as retry with status 0 instead of throwing", async () => {
    const { outcome } = await sendWith(() => {
      throw new TypeError("fetch failed");
    });
    expect(outcome).toEqual({ kind: "retry", status: 0 });
  });

  it("reports other 4xx as failed with the response detail", async () => {
    const { outcome } = await sendWith(
      () => new Response("invalid JWT provided", { status: 403 })
    );
    expect(outcome).toEqual({
      detail: "invalid JWT provided",
      kind: "failed",
      status: 403,
    });
  });

  it("truncates a long failure detail and falls back to the status text", async () => {
    const long = await sendWith(
      () => new Response("x".repeat(1000), { status: 400 })
    );
    expect(long.outcome).toMatchObject({ kind: "failed", status: 400 });
    expect(
      long.outcome.kind === "failed" ? long.outcome.detail : ""
    ).toHaveLength(200);

    const empty = await sendWith(
      () => new Response(null, { status: 413, statusText: "Payload Too Large" })
    );
    expect(empty.outcome).toEqual({
      detail: "Payload Too Large",
      kind: "failed",
      status: 413,
    });
  });
});

describe("sendWebPush local failures", () => {
  it("returns failed without calling fetch when the payload is too large", async () => {
    const { outcome, calls } = await sendWith(
      () => new Response(null, { status: 201 }),
      { payload: "a".repeat(MAX_PLAINTEXT_BYTES + 1) }
    );
    expect(outcome.kind).toBe("failed");
    expect(outcome).toMatchObject({ status: 0 });
    expect(calls).toHaveLength(0);
  });

  it("returns failed for corrupt stored subscription keys", async () => {
    const { outcome, calls } = await sendWith(
      () => new Response(null, { status: 201 }),
      {
        subscription: {
          auth: "AAAA",
          endpoint: ENDPOINT,
          p256dh: "not*base64",
        },
      }
    );
    expect(outcome.kind).toBe("failed");
    expect(calls).toHaveLength(0);
  });

  it("returns failed for a non-https endpoint and an invalid topic", async () => {
    const insecure = await sendWith(() => new Response(null, { status: 201 }), {
      subscription: {
        ...baseOptions.subscription,
        endpoint: "http://x.test/a",
      },
    });
    expect(insecure.outcome.kind).toBe("failed");
    const badTopic = await sendWith(() => new Response(null, { status: 201 }), {
      topic: "has spaces!",
    });
    expect(badTopic.outcome.kind).toBe("failed");
    expect(badTopic.calls).toHaveLength(0);
  });

  it("returns failed for an invalid VAPID subject", async () => {
    const { outcome } = await sendWith(
      () => new Response(null, { status: 201 }),
      { vapid: { ...baseOptions.vapid, subject: "nope" } }
    );
    expect(outcome.kind).toBe("failed");
  });
});
