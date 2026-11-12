/**
 * One-shot error messages that must survive a redirect.
 *
 * Route guards run in `beforeLoad`, which on a first page load is BEFORE the
 * toaster has mounted — a plain `toast.error()` there would be lost. A guard
 * calls `flashError()`; the root route registers a handler (that shows a
 * toast) as soon as it mounts and any queued messages are delivered then.
 */

type FlashHandler = (message: string) => void;

const pending: string[] = [];
let handler: FlashHandler | null = null;

export function flashError(message: string): void {
  if (handler) {
    handler(message);
    return;
  }
  if (!pending.includes(message)) {
    pending.push(message);
  }
}

/** Register (or clear, with `null`) the function that displays flashes; drains the queue. */
export function setFlashHandler(next: FlashHandler | null): void {
  handler = next;
  if (!next) {
    return;
  }
  for (const message of pending.splice(0)) {
    next(message);
  }
}
