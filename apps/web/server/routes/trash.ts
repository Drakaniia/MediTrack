import { trashTypeSchema } from "../../shared/schemas/inventory-input";
import { HttpError, noContent, ok } from "../http";
import type { ProtectedRouteContext, RouteDef } from "../route-types";
import {
  listTrash,
  purgeFromTrash,
  restoreFromTrash,
} from "../services/inventory/trash-service";

/** Trash (spec §7.9): admin-only view over soft-deleted items and batches. */

function readType(ctx: ProtectedRouteContext) {
  const parsed = trashTypeSchema.safeParse(ctx.params.type);
  if (!parsed.success) {
    throw new HttpError("not_found", "Unknown Trash entry type.");
  }
  return parsed.data;
}

async function list(ctx: ProtectedRouteContext): Promise<Response> {
  return ok(await listTrash(ctx.db));
}

async function restore(ctx: ProtectedRouteContext): Promise<Response> {
  await restoreFromTrash(ctx, readType(ctx), ctx.params.id);
  return noContent();
}

async function purge(ctx: ProtectedRouteContext): Promise<Response> {
  await purgeFromTrash(ctx, readType(ctx), ctx.params.id);
  return noContent();
}

export const trashRoutes: RouteDef[] = [
  { access: "trash.manage", handler: list, method: "GET", path: "/api/trash" },
  {
    access: "trash.manage",
    handler: restore,
    method: "POST",
    path: "/api/trash/:type/:id/restore",
  },
  {
    access: "trash.manage",
    handler: purge,
    method: "DELETE",
    path: "/api/trash/:type/:id",
  },
];
