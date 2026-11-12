import { settingsPatchSchema } from "../../shared/settings";
import { ok, parseJson } from "../http";
import type { ProtectedRouteContext, RouteDef } from "../route-types";
import { updateSettings } from "../services/platform/settings";
import { loadSettings } from "../settings-store";

/** Facility settings (spec §7.10) — `settings.manage` (admin). Everyone else reads the public subset via `/auth/me`. */

async function read(ctx: ProtectedRouteContext): Promise<Response> {
  return ok(await loadSettings(ctx.db));
}

async function write(ctx: ProtectedRouteContext): Promise<Response> {
  const patch = await parseJson(ctx, settingsPatchSchema);
  return ok(await updateSettings(ctx, patch));
}

export const settingsRoutes: RouteDef[] = [
  {
    access: "settings.manage",
    handler: read,
    method: "GET",
    path: "/api/settings",
  },
  {
    access: "settings.manage",
    handler: write,
    method: "PUT",
    path: "/api/settings",
  },
];
