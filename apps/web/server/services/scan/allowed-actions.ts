import { can } from "../../../shared/permissions";
import type { Role } from "../../../shared/roles";
import type {
  BatchDto,
  ItemSummaryDto,
} from "../../../shared/schemas/inventory";
import type { ScanAction } from "../../../shared/schemas/scan";

export interface ActionSubject {
  /** The scanned batch, or the item's FEFO batch for an item scan. */
  batch: BatchDto | null;
  item: ItemSummaryDto;
  /** True when the scan named this exact batch (adjust / dispose only make sense then). */
  scannedBatch: boolean;
}

/**
 * Actions the role may take on what was scanned. Derived from the permission table and the
 * state of the stock, never stored; the underlying endpoints enforce the same rules again.
 */
export function allowedActionsFor(
  role: Role,
  subject: ActionSubject
): ScanAction[] {
  const { batch, item, scannedBatch } = subject;
  const actions: ScanAction[] = [];
  if (can(role, "inventory.view")) {
    actions.push("view");
  }
  if (can(role, "requests.create")) {
    actions.push("request");
  }
  if (can(role, "stock.quick_deduct") && item.available > 0) {
    actions.push("quick_deduct");
  }
  if (scannedBatch && batch && can(role, "stock.dispose") && batch.quarantined) {
    actions.push("dispose");
  }
  if (
    scannedBatch &&
    batch &&
    can(role, "stock.adjust") &&
    batch.status === "active"
  ) {
    actions.push("adjust");
  }
  if (batch && can(role, "inventory.write")) {
    actions.push("label");
  }
  if (can(role, "inventory.write")) {
    actions.push("edit");
  }
  return actions;
}
