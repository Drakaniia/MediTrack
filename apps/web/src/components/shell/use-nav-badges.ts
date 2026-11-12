import type { NavPath } from "@/app/nav-config";

/** Counts shown next to sidebar entries. Missing or 0 = no badge. */
export type NavBadges = Partial<Record<NavPath, number>>;

const NO_BADGES: NavBadges = {
  "/inventory/expiry": 0,
  "/inventory/low-stock": 0,
  "/notifications": 0,
  "/requests": 0,
};

/**
 * Sidebar badge counts. Returns zeros for now: the slices that own the numbers
 * (EXP: expiry + low stock, REQ: pending requests, ALERTS: unread) replace
 * this body with a real query.
 */
export function useNavBadges(): NavBadges {
  return NO_BADGES;
}
