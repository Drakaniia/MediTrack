/**
 * Before / after comparison of an audit entry's JSON snapshots. Both sides are
 * flattened to dotted paths (`expiry.urgentDays`), so a nested settings change
 * reads as one line instead of two blobs of JSON.
 */

export type DiffStatus = "added" | "changed" | "removed" | "unchanged";

export interface DiffRow {
  after: string;
  before: string;
  path: string;
  status: DiffStatus;
}

export const DIFF_STATUS_LABELS: Record<DiffStatus, string> = {
  added: "Added",
  changed: "Changed",
  removed: "Removed",
  unchanged: "Unchanged",
};

const ROOT_PATH = "(value)";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function flatten(
  value: unknown,
  path: string,
  into: Map<string, string>
): void {
  if (isPlainObject(value) && Object.keys(value).length > 0) {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, path === "" ? key : `${path}.${key}`, into);
    }
    return;
  }
  into.set(path === "" ? ROOT_PATH : path, JSON.stringify(value) ?? "null");
}

function flatSnapshot(snapshot: unknown): Map<string, string> {
  const flat = new Map<string, string>();
  if (snapshot !== null && snapshot !== undefined) {
    flatten(snapshot, "", flat);
  }
  return flat;
}

function statusOf(
  before: string | undefined,
  after: string | undefined
): DiffStatus {
  if (before === undefined) {
    return "added";
  }
  if (after === undefined) {
    return "removed";
  }
  return before === after ? "unchanged" : "changed";
}

/** One row per path found on either side; paths keep the order they appear in (before first). */
export function diffSnapshots(before: unknown, after: unknown): DiffRow[] {
  const left = flatSnapshot(before);
  const right = flatSnapshot(after);
  const paths = [...new Set([...left.keys(), ...right.keys()])];
  return paths.map((path) => ({
    after: right.get(path) ?? "",
    before: left.get(path) ?? "",
    path,
    status: statusOf(left.get(path), right.get(path)),
  }));
}

export function hasSnapshot(before: unknown, after: unknown): boolean {
  return (
    (before !== null && before !== undefined) ||
    (after !== null && after !== undefined)
  );
}
