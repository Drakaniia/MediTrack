/**
 * `?redirect=` handling. The value comes from the URL, so it is untrusted: only
 * an in-app path may be followed (never `//evil.example`, `/\evil.example`, a
 * scheme, or a control character a browser would strip into one).
 */

const AUTH_PATH = /^\/(?:login|change-password)(?:[/?#]|$)/;
const MAX_REDIRECT_LENGTH = 2048;
const FIRST_PRINTABLE_CODE = 32;
const DELETE_CODE = 127;

function hasControlCharacter(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code < FIRST_PRINTABLE_CODE || code === DELETE_CODE) {
      return true;
    }
  }
  return false;
}

/** The path to return to after signing in, or `undefined` when it is not safe/useful. */
export function sanitizeRedirect(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const target = value.trim();
  if (target === "" || target.length > MAX_REDIRECT_LENGTH) {
    return undefined;
  }
  if (
    !target.startsWith("/") ||
    target.startsWith("//") ||
    target.startsWith("/\\")
  ) {
    return undefined;
  }
  // Returning to /login or /change-password after signing in would just bounce.
  if (hasControlCharacter(target) || AUTH_PATH.test(target)) {
    return undefined;
  }
  return target;
}

/** The `search` object for `/login` and `/change-password`: omitted when the target is home. */
export function redirectSearch(target: unknown): { redirect?: string } {
  const safe = sanitizeRedirect(target);
  return safe && safe !== "/" ? { redirect: safe } : {};
}
