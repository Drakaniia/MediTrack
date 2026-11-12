/*
 * MediTract service worker — Web Push ONLY.
 *
 * The app is online-only (spec §7.6 / §10), so there is deliberately NO fetch handler and
 * NO cache: this worker exists to show alert notifications while no tab is open.
 *
 * Plain JS, no build step, served from /sw.js (scope "/"). The behaviour is unit-tested by
 * running this exact file against a fake worker scope (src/features/alerts/lib/sw.test.ts).
 */

const DEFAULT_TITLE = "MediTract";
const DEFAULT_BODY = "You have stock alerts that need attention.";
const DEFAULT_TAG = "meditract-alerts";
const FALLBACK_URL = "/notifications";
const ICON = "/icons/icon-192.png";
const BADGE = "/icons/icon-192.png";
const SUBSCRIBE_PATH = "/api/push/subscribe";
const CSRF_HEADER = "x-meditract-csrf";

function isText(value) {
  return typeof value === "string" && value.trim() !== "";
}

/** The JSON of a push message, or an empty object when it is missing or not JSON. */
function readPayload(event) {
  if (!event.data) {
    return {};
  }
  try {
    const parsed = event.data.json();
    return parsed !== null && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Same-origin URL for `raw`, as a path; anything else becomes the notifications page. */
function safeUrl(raw, origin) {
  if (!isText(raw)) {
    return FALLBACK_URL;
  }
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin) {
      return FALLBACK_URL;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return FALLBACK_URL;
  }
}

function bodyOf(payload) {
  if (isText(payload.body)) {
    return payload.body;
  }
  if (typeof payload.count === "number" && payload.count > 1) {
    return `${payload.count} new stock alerts.`;
  }
  return DEFAULT_BODY;
}

function buildNotification(payload, origin) {
  const title = isText(payload.title) ? payload.title : DEFAULT_TITLE;
  const options = {
    badge: BADGE,
    body: bodyOf(payload),
    data: { url: safeUrl(payload.url, origin) },
    icon: ICON,
    // One notification per tag: a newer alert replaces the older one instead of stacking.
    renotify: true,
    requireInteraction: payload.severity === "critical",
    tag: isText(payload.tag) ? payload.tag : DEFAULT_TAG,
  };
  return { options, title };
}

function focusAndNavigate(existing, url) {
  return existing
    .focus()
    .then((focused) => (focused || existing).navigate(url))
    .catch(() => self.clients.openWindow(url));
}

function openOrFocus(url) {
  const { origin } = self.location;
  return self.clients
    .matchAll({ includeUncontrolled: true, type: "window" })
    .then((windows) => {
      const existing = windows.find((client) => client.url.startsWith(origin));
      if (!existing) {
        return self.clients.openWindow(url);
      }
      return focusAndNavigate(existing, url);
    });
}

function readKey(subscription) {
  const options = subscription?.options;
  return options?.applicationServerKey ?? null;
}

function obtainSubscription(event) {
  if (event.newSubscription) {
    return Promise.resolve(event.newSubscription);
  }
  const key = readKey(event.oldSubscription);
  if (!key) {
    return Promise.reject(
      new Error("No applicationServerKey to re-subscribe with.")
    );
  }
  return self.registration.pushManager.subscribe({
    applicationServerKey: key,
    userVisibleOnly: true,
  });
}

/** Subscribes again with the same server key and tells the API about the new endpoint. */
function resubscribe(event) {
  return obtainSubscription(event).then((subscription) => {
    const json = subscription.toJSON();
    return fetch(SUBSCRIBE_PATH, {
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: json.keys,
        userAgent: self.navigator?.userAgent,
      }),
      credentials: "same-origin",
      headers: { "content-type": "application/json", [CSRF_HEADER]: "1" },
      method: "POST",
    });
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  const { options, title } = buildNotification(
    readPayload(event),
    self.location.origin
  );
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = safeUrl(event.notification.data?.url, self.location.origin);
  event.waitUntil(openOrFocus(url));
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(resubscribe(event).catch(() => undefined));
});
