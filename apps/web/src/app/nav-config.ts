import type { Permission } from "@shared/permissions";
import {
  BarChart3,
  Bell,
  BookOpen,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  FileText,
  LayoutDashboard,
  type LucideIcon,
  Package,
  PackagePlus,
  QrCode,
  ScanLine,
  ScrollText,
  Settings,
  ShieldAlert,
  SortAsc,
  Trash2,
  TrendingDown,
  Users,
} from "lucide-react";

/**
 * The single source of truth for navigation: the sidebar renders it, the
 * future command palette searches it, and `visibleNav()` filters it by the
 * signed-in role's permissions. Every entry mirrors a route in
 * ARCHITECTURE.md §6 "SPA routes".
 */

export type NavPath =
  | "/"
  | "/analytics"
  | "/audit"
  | "/dispensing"
  | "/docs"
  | "/inventory"
  | "/inventory/add"
  | "/inventory/expiry"
  | "/inventory/fefo"
  | "/inventory/low-stock"
  | "/inventory/quarantine"
  | "/labels"
  | "/notifications"
  | "/reports"
  | "/requests"
  | "/scan"
  | "/settings"
  | "/trash"
  | "/users";

export type NavRequirement = Permission | "authenticated";

export interface NavItem {
  icon: LucideIcon;
  label: string;
  /** Needed to see the entry; mirrors the route's `beforeLoad` guard. */
  permission: NavRequirement;
  to: NavPath;
}

export interface NavSection {
  items: readonly NavItem[];
  title: string;
}

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    items: [
      {
        icon: LayoutDashboard,
        label: "Dashboard",
        permission: "dashboard.view",
        to: "/",
      },
      { icon: ScanLine, label: "Scan", permission: "scan.use", to: "/scan" },
      {
        icon: Bell,
        label: "Notifications",
        permission: "alerts.view",
        to: "/notifications",
      },
    ],
    title: "Overview",
  },
  {
    items: [
      {
        icon: Package,
        label: "Inventory",
        permission: "inventory.view",
        to: "/inventory",
      },
      {
        icon: PackagePlus,
        label: "Add stock",
        permission: "inventory.write",
        to: "/inventory/add",
      },
      {
        icon: SortAsc,
        label: "Use first (FEFO)",
        permission: "inventory.view",
        to: "/inventory/fefo",
      },
      {
        icon: CalendarClock,
        label: "Expiry",
        permission: "inventory.view",
        to: "/inventory/expiry",
      },
      {
        icon: TrendingDown,
        label: "Low stock",
        permission: "inventory.view",
        to: "/inventory/low-stock",
      },
      {
        icon: ShieldAlert,
        label: "Quarantine",
        permission: "inventory.view",
        to: "/inventory/quarantine",
      },
      {
        icon: QrCode,
        label: "Labels",
        permission: "inventory.write",
        to: "/labels",
      },
    ],
    title: "Inventory",
  },
  {
    items: [
      {
        icon: ClipboardList,
        label: "Requests",
        permission: "requests.view",
        to: "/requests",
      },
      {
        icon: ClipboardCheck,
        label: "Dispensing log",
        permission: "dispensing.view",
        to: "/dispensing",
      },
    ],
    title: "Requests",
  },
  {
    items: [
      {
        icon: BarChart3,
        label: "Analytics",
        permission: "analytics.view",
        to: "/analytics",
      },
      {
        icon: FileText,
        label: "Reports",
        permission: "reports.view",
        to: "/reports",
      },
    ],
    title: "Insights",
  },
  {
    items: [
      {
        icon: ScrollText,
        label: "Audit log",
        permission: "audit.view",
        to: "/audit",
      },
      {
        icon: Trash2,
        label: "Trash",
        permission: "trash.manage",
        to: "/trash",
      },
      {
        icon: Users,
        label: "Users",
        permission: "users.manage",
        to: "/users",
      },
      {
        icon: Settings,
        label: "Settings",
        permission: "authenticated",
        to: "/settings",
      },
    ],
    title: "Administration",
  },
  {
    items: [
      {
        icon: BookOpen,
        label: "Docs",
        permission: "authenticated",
        to: "/docs",
      },
    ],
    title: "Help",
  },
];

/** Every nav entry, flattened (the command palette searches this). */
export const NAV_ITEMS: readonly NavItem[] = NAV_SECTIONS.flatMap(
  (section) => section.items
);

function isVisible(
  requirement: NavRequirement,
  permissions: readonly Permission[]
): boolean {
  return requirement === "authenticated" || permissions.includes(requirement);
}

/** The sections a role may see: entries it lacks the permission for are dropped, empty sections too. */
export function visibleNav(
  permissions: readonly Permission[]
): readonly NavSection[] {
  const sections: NavSection[] = [];
  for (const section of NAV_SECTIONS) {
    const items = section.items.filter((item) =>
      isVisible(item.permission, permissions)
    );
    if (items.length > 0) {
      sections.push({ items, title: section.title });
    }
  }
  return sections;
}

function matchesPath(pathname: string, to: NavPath): boolean {
  if (to === "/") {
    return pathname === "/";
  }
  return pathname === to || pathname.startsWith(`${to}/`);
}

/**
 * The entry that should look "current" for `pathname`: the longest matching
 * path, so `/inventory/add` highlights "Add stock", not "Inventory".
 */
export function activeNavPath(pathname: string): NavPath | null {
  let best: NavPath | null = null;
  for (const item of NAV_ITEMS) {
    if (
      matchesPath(pathname, item.to) &&
      (best === null || item.to.length > best.length)
    ) {
      best = item.to;
    }
  }
  return best;
}
