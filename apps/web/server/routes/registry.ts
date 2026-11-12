import type { RouteDef } from "../route-types";
import { alertRunRoutes } from "./alert-run";
import { alertRoutes } from "./alerts";
import { analyticsRoutes } from "./analytics";
import { auditRoutes } from "./audit";
import { authRoutes } from "./auth";
import { batchRoutes } from "./batches";
import { dashboardRoutes } from "./dashboard";
import { dispensingRoutes } from "./dispensing";
import { expiryRoutes } from "./expiry";
import { healthRoutes } from "./health";
import { itemRoutes } from "./items";
import { pushRoutes } from "./push";
import { reportRoutes } from "./reports";
import { requestRoutes } from "./requests";
import { scanRoutes } from "./scan";
import { settingsRoutes } from "./settings";
import { trashRoutes } from "./trash";
import { userRoutes } from "./users";

/**
 * Every route the API serves. A slice registers its routes by exporting a `RouteDef[]`
 * from its own module and listing it here; `compileRoutes` (called by `handleApi`) refuses
 * the whole table if any entry lacks an `access` rule or duplicates another method+path,
 * and `test/permissions-matrix.test.ts` checks each entry against `shared/permissions.ts`.
 */
export const ALL_ROUTES: RouteDef[] = [
  ...healthRoutes,
  ...authRoutes,
  ...userRoutes,
  ...settingsRoutes,
  ...auditRoutes,
  ...itemRoutes,
  ...batchRoutes,
  ...trashRoutes,
  ...expiryRoutes,
  ...requestRoutes,
  ...dispensingRoutes,
  ...scanRoutes,
  ...alertRoutes,
  ...pushRoutes,
  ...alertRunRoutes,
  ...dashboardRoutes,
  ...analyticsRoutes,
  ...reportRoutes,
];
