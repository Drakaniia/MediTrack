const FIRST_PRINTABLE_CODE = 32;
const DELETE_CODE = 127;

function isControl(char: string): boolean {
  const code = char.codePointAt(0) ?? FIRST_PRINTABLE_CODE;
  return code < FIRST_PRINTABLE_CODE || code === DELETE_CODE;
}

/**
 * What a scanner or a keyboard left in a field, reduced to the code itself. Scanners may wrap a
 * code in control characters (STX/ETX, Tab, CR/LF) and padding.
 */
export function cleanScanText(raw: string): string {
  return [...raw].filter((char) => !isControl(char)).join("").trim();
}

const EDITABLE_SELECTOR =
  'input:not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="reset"]):not([type="range"]):not([type="color"]):not([type="file"]):not([type="image"]), textarea, select, [contenteditable=""], [contenteditable="true"]';

/** True when typing into `target` enters text (so a global scan listener must stay out of it). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return target.isContentEditable || target.closest(EDITABLE_SELECTOR) !== null;
}
