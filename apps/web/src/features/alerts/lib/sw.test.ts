import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

/**
 * Runs the REAL `public/sw.js` against a fake service-worker scope, so the behaviour that
 * ships (and nothing else) is what is tested.
 */

const SOURCE = readFileSync(
  resolve(import.meta.dirname, "../../../../public/sw.js"),
  "utf8"
);
const ORIGIN = "https://meditract.test";

interface FakeWindow {
  focus: ReturnType<typeof vi.fn>;
  navigate: ReturnType<typeof vi.fn>;
  url: string;
}

interface Harness {
  dispatch: (type: string, event?: Record<string, unknown>) => Promise<void>;
  fetch: ReturnType<typeof vi.fn>;
  listeners: Map<string, (event: unknown) => void>;
  scope: {
    clients: {
      claim: ReturnType<typeof vi.fn>;
      matchAll: ReturnType<typeof vi.fn>;
      openWindow: ReturnType<typeof vi.fn>;
    };
    registration: {
      pushManager: { subscribe: ReturnType<typeof vi.fn> };
      showNotification: ReturnType<typeof vi.fn>;
    };
    skipWaiting: ReturnType<typeof vi.fn>;
  };
}

function fakeWindow(url: string): FakeWindow {
  const client: FakeWindow = {
    focus: vi.fn(),
    navigate: vi.fn(async () => undefined),
    url,
  };
  client.focus.mockImplementation(async () => client);
  return client;
}

function loadWorker(windows: FakeWindow[] = []): Harness {
  const listeners = new Map<string, (event: unknown) => void>();
  const fetchStub = vi.fn(async () => ({ ok: true }));
  const scope = {
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async () => windows),
      openWindow: vi.fn(async () => null),
    },
    registration: {
      pushManager: {
        subscribe: vi.fn(async () => ({
          toJSON: () => ({
            endpoint: "https://push.example.test/new",
            keys: { auth: "AUTH", p256dh: "P256DH" },
          }),
        })),
      },
      showNotification: vi.fn(async () => undefined),
    },
    skipWaiting: vi.fn(async () => undefined),
  };
  runInNewContext(SOURCE, {
    fetch: fetchStub,
    self: {
      ...scope,
      addEventListener: (type: string, listener: (event: unknown) => void) => {
        listeners.set(type, listener);
      },
      location: { origin: ORIGIN },
      navigator: { userAgent: "Test UA" },
    },
    URL,
  });
  const dispatch: Harness["dispatch"] = async (type, event = {}) => {
    let pending: Promise<unknown> = Promise.resolve();
    const listener = listeners.get(type);
    if (!listener) {
      throw new Error(`No ${type} listener`);
    }
    listener({
      ...event,
      waitUntil: (promise: Promise<unknown>) => {
        pending = promise;
      },
    });
    await pending;
  };
  return { dispatch, fetch: fetchStub, listeners, scope };
}

function pushEvent(payload: unknown): Record<string, unknown> {
  return { data: { json: () => payload } };
}

describe("service worker lifecycle", () => {
  it("activates immediately and claims open pages", async () => {
    const worker = loadWorker();
    await worker.dispatch("install");
    await worker.dispatch("activate");
    expect(worker.scope.skipWaiting).toHaveBeenCalledOnce();
    expect(worker.scope.clients.claim).toHaveBeenCalledOnce();
  });

  it("has no fetch handler (online-only, nothing is cached)", () => {
    const { listeners } = loadWorker();
    expect(listeners.has("fetch")).toBe(false);
    expect([...listeners.keys()].sort()).toEqual([
      "activate",
      "install",
      "notificationclick",
      "push",
      "pushsubscriptionchange",
    ]);
  });
});

describe("push", () => {
  it("shows the payload with tag, icon and click target", async () => {
    const worker = loadWorker();
    await worker.dispatch(
      "push",
      pushEvent({
        body: "3 batches expire this week.",
        severity: "critical",
        tag: "expiry-2026-11-12",
        title: "Expiry alert",
        url: "/inventory/expiry?class=urgent",
      })
    );

    expect(worker.scope.registration.showNotification).toHaveBeenCalledWith(
      "Expiry alert",
      expect.objectContaining({
        body: "3 batches expire this week.",
        data: { url: "/inventory/expiry?class=urgent" },
        icon: "/icons/icon-192.png",
        requireInteraction: true,
        tag: "expiry-2026-11-12",
      })
    );
  });

  it("falls back to a generic notification without a payload", async () => {
    const worker = loadWorker();
    await worker.dispatch("push", {});

    expect(worker.scope.registration.showNotification).toHaveBeenCalledWith(
      "MediTract",
      expect.objectContaining({
        data: { url: "/notifications" },
        requireInteraction: false,
        tag: "meditract-alerts",
      })
    );
  });

  it("falls back when the payload is not JSON", async () => {
    const worker = loadWorker();
    await worker.dispatch("push", {
      data: {
        json: () => {
          throw new SyntaxError("Unexpected token");
        },
      },
    });

    expect(worker.scope.registration.showNotification).toHaveBeenCalledWith(
      "MediTract",
      expect.objectContaining({ tag: "meditract-alerts" })
    );
  });

  it("summarises a count when there is no body, and ignores off-site urls", async () => {
    const worker = loadWorker();
    await worker.dispatch(
      "push",
      pushEvent({ count: 4, title: "Stock alerts", url: "https://evil.test/x" })
    );

    expect(worker.scope.registration.showNotification).toHaveBeenCalledWith(
      "Stock alerts",
      expect.objectContaining({
        body: "4 new stock alerts.",
        data: { url: "/notifications" },
      })
    );
  });
});

describe("notificationclick", () => {
  function clickEvent(url: unknown): Record<string, unknown> {
    return { notification: { close: vi.fn(), data: { url } } };
  }

  it("focuses an open window and navigates it", async () => {
    const open = fakeWindow(`${ORIGIN}/inventory`);
    const worker = loadWorker([open]);
    const event = clickEvent("/inventory/low-stock");

    await worker.dispatch("notificationclick", event);

    expect(
      (event.notification as { close: () => void }).close
    ).toHaveBeenCalled();
    expect(open.focus).toHaveBeenCalled();
    expect(open.navigate).toHaveBeenCalledWith("/inventory/low-stock");
    expect(worker.scope.clients.openWindow).not.toHaveBeenCalled();
  });

  it("opens a new window when none is open", async () => {
    const worker = loadWorker([]);
    await worker.dispatch("notificationclick", clickEvent("/notifications"));
    expect(worker.scope.clients.openWindow).toHaveBeenCalledWith(
      "/notifications"
    );
  });

  it("never navigates to another origin", async () => {
    const worker = loadWorker([]);
    await worker.dispatch(
      "notificationclick",
      clickEvent("https://evil.test/phish")
    );
    expect(worker.scope.clients.openWindow).toHaveBeenCalledWith(
      "/notifications"
    );
  });
});

describe("pushsubscriptionchange", () => {
  it("re-subscribes with the old key and posts the new subscription with the CSRF header", async () => {
    const worker = loadWorker();
    const key = new ArrayBuffer(65);

    await worker.dispatch("pushsubscriptionchange", {
      oldSubscription: { options: { applicationServerKey: key } },
    });

    expect(
      worker.scope.registration.pushManager.subscribe
    ).toHaveBeenCalledWith({
      applicationServerKey: key,
      userVisibleOnly: true,
    });
    expect(worker.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = worker.fetch.mock.calls[0] as unknown as [
      string,
      { body: string; headers: Record<string, string>; method: string },
    ];
    expect(url).toBe("/api/push/subscribe");
    expect(init.method).toBe("POST");
    expect(init.headers["x-meditract-csrf"]).toBe("1");
    expect(JSON.parse(init.body)).toEqual({
      endpoint: "https://push.example.test/new",
      keys: { auth: "AUTH", p256dh: "P256DH" },
      userAgent: "Test UA",
    });
  });

  it("uses the browser's new subscription when it already made one", async () => {
    const worker = loadWorker();
    await worker.dispatch("pushsubscriptionchange", {
      newSubscription: {
        toJSON: () => ({
          endpoint: "https://push.example.test/made-by-browser",
          keys: { auth: "A", p256dh: "P" },
        }),
      },
    });
    expect(
      worker.scope.registration.pushManager.subscribe
    ).not.toHaveBeenCalled();
    expect(worker.fetch).toHaveBeenCalledTimes(1);
  });

  it("does not throw when there is nothing to re-subscribe with", async () => {
    const worker = loadWorker();
    await worker.dispatch("pushsubscriptionchange", {});
    expect(worker.fetch).not.toHaveBeenCalled();
  });
});
