/** Facility-local "today" for one request, read once from settings. */

import { todayInZone } from "../../../shared/dates";
import type { D1DatabaseLike } from "../../env";
import { loadSettings } from "../../settings-store";

export interface FacilityDay {
  timezone: string;
  /** Facility-local `YYYY-MM-DD`. */
  today: string;
}

export async function loadFacilityDay(
  db: D1DatabaseLike,
  now: Date
): Promise<FacilityDay> {
  const { facility } = await loadSettings(db);
  return {
    timezone: facility.timezone,
    today: todayInZone(now, facility.timezone),
  };
}

export function displayName(name: string, strength: string): string {
  return strength === "" ? name : `${name} ${strength}`;
}
