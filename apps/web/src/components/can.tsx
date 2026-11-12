import type { Permission } from "@shared/permissions";
import type { ReactNode } from "react";

import { useCan } from "@/lib/auth/guards";

export interface CanProps {
  children: ReactNode;
  /** Rendered when the role lacks the permission. Default: nothing. */
  fallback?: ReactNode;
  permission: Permission;
}

/**
 * Shows `children` only to roles holding `permission`. This HIDES controls; the
 * API still enforces every permission, so never rely on it for security.
 */
export function Can({
  children,
  fallback = null,
  permission,
}: CanProps): ReactNode {
  const allowed = useCan(permission);
  return allowed ? children : fallback;
}
