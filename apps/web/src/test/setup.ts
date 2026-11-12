import "@testing-library/jest-dom/vitest";

import { afterEach } from "vitest";

import { resetOnlineState } from "@/lib/online";

import { restoreMockApi } from "./mock-api";

/**
 * Per-file test setup (client project). jsdom lacks several browser APIs that
 * Base UI, sonner and the shell use; they are stubbed here (ported from the
 * desktop app's setup).
 */

const noop = (): void => undefined;

// jsdom lacks matchMedia; sonner (Toaster), next-themes and the shell need it.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    value: (query: string) => ({
      addEventListener: () => undefined,
      addListener: () => undefined,
      dispatchEvent: () => false,
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: () => undefined,
      removeListener: () => undefined,
    }),
    writable: true,
  });
}

if (typeof window !== "undefined") {
  const target = window as unknown as Record<string, unknown>;
  if (typeof target.PointerEvent !== "function") {
    target.PointerEvent = window.MouseEvent;
  }
  const proto = window.HTMLElement.prototype as unknown as Record<
    string,
    unknown
  >;
  if (typeof proto.hasPointerCapture !== "function") {
    proto.hasPointerCapture = () => false;
  }
  if (typeof proto.setPointerCapture !== "function") {
    proto.setPointerCapture = () => undefined;
  }
  if (typeof proto.releasePointerCapture !== "function") {
    proto.releasePointerCapture = () => undefined;
  }
  if (typeof proto.scrollIntoView !== "function") {
    proto.scrollIntoView = () => undefined;
  }
  if (typeof window.ResizeObserver === "undefined") {
    target.ResizeObserver = class ResizeObserver {
      disconnect = noop;
      observe = noop;
      unobserve = noop;
    };
  }
  // jsdom defines scrollTo as a "not implemented" error logger; the router's
  // scroll restoration calls it on every navigation.
  window.scrollTo = () => undefined;
}

// jsdom has no Web Animations API. Without this stub Base UI keeps popovers in
// their "starting style" and polls every animation frame, which slows a test
// with an open popover from milliseconds to tens of seconds.
if (typeof Element !== "undefined" && !Element.prototype.getAnimations) {
  Object.defineProperty(Element.prototype, "getAnimations", {
    value: () => [] as unknown as Animation[],
    writable: true,
  });
}

afterEach(() => {
  resetOnlineState();
  localStorage.clear();
  delete document.documentElement.dataset.density;
  // Last: throws when a test made a request nobody handled.
  restoreMockApi();
});
