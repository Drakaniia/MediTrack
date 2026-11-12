import { describe, expect, it } from "vitest";

import { ROLES } from "../shared/roles";
import type {
  PushConfigDto,
  PushSubscriptionDto,
} from "../shared/schemas/alerts";
import { createTestApp, type TestClient } from "./app";

const P256DH = Buffer.alloc(65, 4).toString("base64url");
const AUTH = Buffer.alloc(16, 7).toString("base64url");

function subscription(
  n: number,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    endpoint: `https://push.example.test/send/device-${n}-token`,
    keys: { auth: AUTH, p256dh: P256DH },
    userAgent: "Vitest",
    ...overrides,
  };
}

async function listDevices(client: TestClient): Promise<PushSubscriptionDto[]> {
  const response = await client.get<PushSubscriptionDto[]>(
    "/api/push/subscriptions"
  );
  expect(response.status).toBe(200);
  return response.data;
}

describe("GET /api/push/config", () => {
  it("is disabled without a VAPID key", async () => {
    const app = await createTestApp();
    const client = await app.loginAs("nurse");

    const response = await client.get<PushConfigDto>("/api/push/config");

    expect(response.data).toEqual({ enabled: false, publicKey: null });
  });

  it("hands out the public key when configured and the setting is on", async () => {
    const app = await createTestApp();
    app.env.VAPID_PUBLIC_KEY = "BPublicKeyValue";
    const client = await app.loginAs("nurse");

    expect((await client.get<PushConfigDto>("/api/push/config")).data).toEqual({
      enabled: true,
      publicKey: "BPublicKeyValue",
    });

    await app.setSettings({ alerts: { push: false } });
    expect((await client.get<PushConfigDto>("/api/push/config")).data).toEqual({
      enabled: false,
      publicKey: "BPublicKeyValue",
    });
  });
});

describe("POST /api/push/subscribe", () => {
  it("stores the subscription and returns a DTO without the secrets", async () => {
    const app = await createTestApp();
    const client = await app.loginAs("nurse");

    const response = await client.post<PushSubscriptionDto>(
      "/api/push/subscribe",
      subscription(1)
    );

    expect(response.status).toBe(200);
    expect(response.data).toMatchObject({
      endpointHost: "push.example.test",
      endpointTail: "-1-token",
      lastSuccessAt: null,
      userAgent: "Vitest",
    });
    expect(JSON.stringify(response.body)).not.toContain(P256DH);
    expect(JSON.stringify(response.body)).not.toContain(AUTH);
    const row = app.sqlite
      .prepare("SELECT p256dh, auth, failure_count FROM push_subscriptions")
      .get() as { auth: string; failure_count: number; p256dh: string };
    expect(row).toEqual({ auth: AUTH, failure_count: 0, p256dh: P256DH });
  });

  it("is an upsert on the endpoint for the same user", async () => {
    const app = await createTestApp();
    const client = await app.loginAs("nurse");
    await client.post("/api/push/subscribe", subscription(1));
    await client.post(
      "/api/push/subscribe",
      subscription(1, { userAgent: "Other" })
    );

    const devices = await listDevices(client);

    expect(devices).toHaveLength(1);
    expect(devices[0].userAgent).toBe("Other");
  });

  it("re-assigns an endpoint that another account registers", async () => {
    const app = await createTestApp();
    const alice = await app.loginAs("nurse");
    const bob = await app.loginAs("pharmacist");
    await alice.post("/api/push/subscribe", subscription(1));

    const response = await bob.post("/api/push/subscribe", subscription(1));

    expect(response.status).toBe(200);
    expect(await listDevices(alice)).toEqual([]);
    expect(await listDevices(bob)).toHaveLength(1);
    expect(
      (
        app.sqlite
          .prepare("SELECT COUNT(*) AS n FROM push_subscriptions")
          .get() as { n: number }
      ).n
    ).toBe(1);
  });

  it.each([
    ["a non-https endpoint", { endpoint: "http://push.example.test/x" }],
    ["a non-url endpoint", { endpoint: "not a url" }],
    [
      "an endpoint over 2048 characters",
      { endpoint: `https://push.example.test/${"a".repeat(2050)}` },
    ],
    [
      "p256dh of the wrong size",
      { keys: { auth: AUTH, p256dh: Buffer.alloc(64).toString("base64url") } },
    ],
    [
      "auth of the wrong size",
      {
        keys: { auth: Buffer.alloc(15).toString("base64url"), p256dh: P256DH },
      },
    ],
    [
      "keys that are not base64url",
      { keys: { auth: AUTH, p256dh: `${"+".repeat(87)}` } },
    ],
    ["missing keys", { keys: undefined }],
    ["an over-long user agent", { userAgent: "x".repeat(600) }],
  ])("rejects %s", async (_label, overrides) => {
    const app = await createTestApp();
    const client = await app.loginAs("nurse");

    const response = await client.post(
      "/api/push/subscribe",
      subscription(1, overrides)
    );

    expect(response.status).toBe(400);
    expect(response.error?.code).toBe("validation_error");
    expect(await listDevices(client)).toEqual([]);
  });

  it("keeps at most 10 subscriptions per user, dropping the oldest", async () => {
    const app = await createTestApp();
    const client = await app.loginAs("nurse");
    const other = await app.loginAs("nurse");
    await other.post("/api/push/subscribe", subscription(99));

    for (let n = 1; n <= 12; n += 1) {
      await client.post("/api/push/subscribe", subscription(n));
      app.clock.advance(1000);
    }

    const devices = await listDevices(client);
    expect(devices).toHaveLength(10);
    const tails = devices.map((device) => device.endpointTail);
    expect(tails[0]).toBe("12-token");
    expect(tails).toContain("-3-token");
    expect(tails).not.toContain("-1-token");
    expect(tails).not.toContain("-2-token");
    expect(await listDevices(other)).toHaveLength(1);
  });
});

describe("POST /api/push/unsubscribe", () => {
  it("removes only the caller's own subscription", async () => {
    const app = await createTestApp();
    const alice = await app.loginAs("nurse");
    const bob = await app.loginAs("nurse");
    await alice.post("/api/push/subscribe", subscription(1));
    const { endpoint } = subscription(1);

    const foreign = await bob.post<{ removed: boolean }>(
      "/api/push/unsubscribe",
      { endpoint }
    );
    expect(foreign.data.removed).toBe(false);
    expect(await listDevices(alice)).toHaveLength(1);

    const own = await alice.post<{ removed: boolean }>(
      "/api/push/unsubscribe",
      { endpoint }
    );
    expect(own.data.removed).toBe(true);
    expect(await listDevices(alice)).toEqual([]);

    const again = await alice.post<{ removed: boolean }>(
      "/api/push/unsubscribe",
      { endpoint }
    );
    expect(again.status).toBe(200);
    expect(again.data.removed).toBe(false);
  });

  it("requires an endpoint", async () => {
    const app = await createTestApp();
    const client = await app.loginAs("nurse");
    expect((await client.post("/api/push/unsubscribe", {})).status).toBe(400);
  });
});

describe("GET /api/push/subscriptions and DELETE /:id", () => {
  it("lists only the caller's devices, newest first, with the host only", async () => {
    const app = await createTestApp();
    const alice = await app.loginAs("nurse");
    const bob = await app.loginAs("nurse");
    await alice.post("/api/push/subscribe", subscription(1));
    app.clock.advance(1000);
    await alice.post("/api/push/subscribe", subscription(2));
    await bob.post("/api/push/subscribe", subscription(3));

    const devices = await listDevices(alice);

    expect(devices).toHaveLength(2);
    expect(devices[0].endpointTail).toContain("2-token");
    for (const device of devices) {
      expect(Object.keys(device).sort()).toEqual([
        "createdAt",
        "endpointHost",
        "endpointTail",
        "id",
        "lastSuccessAt",
        "userAgent",
      ]);
      expect(device.endpointHost).toBe("push.example.test");
    }
  });

  it("removes a device by id, own devices only", async () => {
    const app = await createTestApp();
    const alice = await app.loginAs("nurse");
    const bob = await app.loginAs("nurse");
    const created = await alice.post<PushSubscriptionDto>(
      "/api/push/subscribe",
      subscription(1)
    );
    const { id } = created.data;

    const foreign = await bob.delete(`/api/push/subscriptions/${id}`);
    expect(foreign.status).toBe(404);
    expect(await listDevices(alice)).toHaveLength(1);

    const own = await alice.delete(`/api/push/subscriptions/${id}`);
    expect(own.status).toBe(204);
    expect(await listDevices(alice)).toEqual([]);
  });
});

describe("push access", () => {
  it("lets every role manage its own devices", async () => {
    const app = await createTestApp();
    for (const role of ROLES) {
      const client = await app.loginAs(role);
      expect((await client.get("/api/push/config")).status, role).toBe(200);
      expect(
        (
          await client.post(
            "/api/push/subscribe",
            subscription(ROLES.indexOf(role))
          )
        ).status,
        role
      ).toBe(200);
      expect((await client.get("/api/push/subscriptions")).status, role).toBe(
        200
      );
    }
  });

  it("answers 401 to anonymous callers", async () => {
    const app = await createTestApp();
    for (const [method, path] of [
      ["GET", "/api/push/config"],
      ["POST", "/api/push/subscribe"],
      ["POST", "/api/push/unsubscribe"],
      ["GET", "/api/push/subscriptions"],
      ["DELETE", "/api/push/subscriptions/abc"],
    ] as const) {
      const response = await app.anonymous.request(method, path);
      expect(response.status, path).toBe(401);
    }
  });
});
