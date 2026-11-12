import type { Permission } from "@shared/permissions";
import {
  type RequestAction,
  requestActions,
} from "@shared/request-transitions";
import type { RequestDto } from "@shared/schemas/requests";

import { usePermissions } from "@/lib/auth/guards";
import { useCachedMe } from "@/lib/auth/queries";

const PROCESS: Permission = "requests.process";

/** Pure rule behind `useAllowedActions` (kept apart so it is testable). */
export function allowedActionsFor(
  request: RequestDto,
  permissions: readonly Permission[],
  userId: string | null
): RequestAction[] {
  const canProcess = permissions.includes(PROCESS);
  const isOwner =
    userId !== null &&
    request.requestedBy === userId &&
    permissions.includes("requests.create");
  const partlyHandedOver = request.dispensedQty > 0;

  return requestActions(request.status).filter((action) => {
    if (action.id === "cancel") {
      return (canProcess || isOwner) && !partlyHandedOver;
    }
    if (action.permission === undefined) {
      return true;
    }
    if (!permissions.includes(action.permission)) {
      return false;
    }
    // Once part of a request was handed over it can only be completed.
    return !partlyHandedOver || action.id === "dispense";
  });
}

/** The card menu / detail footer actions this user may perform on `request`. */
export function useAllowedActions(request: RequestDto): RequestAction[] {
  const permissions = usePermissions();
  const userId = useCachedMe().data?.user.id ?? null;
  return allowedActionsFor(request, permissions, userId);
}
