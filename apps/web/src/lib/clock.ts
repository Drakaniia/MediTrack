import { useSyncExternalStore } from "react";

/**
 * A shared one-minute clock: every component that needs "now" re-renders when
 * the minute ticks, from ONE interval (started with the first subscriber,
 * stopped with the last). `useFacility()` builds the facility's "today" on it,
 * so the date rolls over at facility midnight without a reload.
 */

const TICK_MS = 60_000;

const listeners = new Set<() => void>();
let snapshot = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;

function tick(): void {
  snapshot = Date.now();
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === undefined) {
    // Nobody was ticking, so the stored value may be stale.
    snapshot = Date.now();
    timer = setInterval(tick, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

function getSnapshot(): number {
  return snapshot;
}

/** The browser clock in epoch ms, refreshed every 60 s. */
export function useMinuteClock(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
