/**
 * `PUT /api/settings` (spec §7.10): merge the patch over the stored settings, validate the
 * RESULT (cross-field rules like urgent < near live there), then write the changed keys and
 * the audit row in one batch. A patch that changes nothing writes and audits nothing.
 */

import {
  type AppSettings,
  mergeSettings,
  type SettingsPatch,
  validateSettings,
} from "../../../shared/settings";
import { actorOf, auditStatement } from "../../audit";
import { HttpError } from "../../http";
import type { ProtectedRouteContext } from "../../route-types";
import {
  describeSettingsChange,
  loadSettings,
  settingsWriteStatements,
} from "../../settings-store";

export async function updateSettings(
  ctx: ProtectedRouteContext,
  patch: SettingsPatch
): Promise<AppSettings> {
  const previous = await loadSettings(ctx.db);
  const next = mergeSettings(previous, patch);

  const problems = validateSettings(next);
  if (problems.length > 0) {
    throw new HttpError("validation_error", "The settings are not valid.", {
      issues: problems.map((message) => ({ message, path: "" })),
    });
  }

  const change = describeSettingsChange(next, previous);
  if (change.keys.length === 0) {
    return next;
  }
  await ctx.db.batch([
    ...settingsWriteStatements(ctx.db, next, previous, {
      actorId: ctx.user.id,
      now: ctx.now,
    }),
    auditStatement(ctx.db, {
      action: "settings.update",
      actor: actorOf(ctx.user),
      after: change.after,
      at: ctx.now.toISOString(),
      before: change.before,
      entityType: "settings",
      ip: ctx.ip,
      summary: `Updated settings: ${change.keys.join(", ")}`,
    }),
  ]);
  return next;
}
