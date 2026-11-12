import { cn } from "@cmis/ui/lib/utils";
import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactElement } from "react";

import {
  activeNavPath,
  type NavItem,
  type NavSection,
  visibleNav,
} from "@/app/nav-config";
import { useNavBadges } from "@/components/shell/use-nav-badges";
import { usePermissions } from "@/lib/auth/guards";

export interface SidebarNavProps {
  /** Icon-only rail (desktop). Labels stay in the DOM for screen readers. */
  collapsed?: boolean;
  /** Called after a link is chosen (the mobile drawer closes itself). */
  onNavigate?: () => void;
}

const BADGE_MAX = 99;

function NavBadge({
  count,
}: {
  count: number | undefined;
}): ReactElement | null {
  if (!count || count < 1) {
    return null;
  }
  return (
    <span className="ml-auto shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 font-semibold text-[10px] text-primary tabular-nums leading-none">
      {count > BADGE_MAX ? `${BADGE_MAX}+` : String(count)}
    </span>
  );
}

function NavLink({
  active,
  badge,
  collapsed,
  item,
  onNavigate,
}: {
  active: boolean;
  badge: number | undefined;
  collapsed: boolean;
  item: NavItem;
  onNavigate?: () => void;
}): ReactElement {
  // The router's own active state is fuzzy ("/inventory" is active on
  // "/inventory/add"), and it always sets aria-current when it is. Exact
  // matching keeps it out of the way; `activeNavPath` picks the single most
  // specific entry, including for nested pages such as /docs/<slug>.
  return (
    <Link
      activeOptions={{ exact: true }}
      aria-current={active ? "page" : undefined}
      className={cn(
        "tap-target group relative flex min-h-9 items-center gap-2.5 rounded-md px-2.5 py-1.5 font-medium text-[13px] leading-tight outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        collapsed && "justify-center px-0"
      )}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      to={item.to}
    >
      <item.icon aria-hidden className="size-4 shrink-0" />
      <span className={cn("min-w-0 truncate", collapsed && "sr-only")}>
        {item.label}
      </span>
      {collapsed ? null : <NavBadge count={badge} />}
    </Link>
  );
}

function NavGroup({
  activePath,
  badges,
  collapsed,
  onNavigate,
  section,
}: {
  activePath: string | null;
  badges: ReturnType<typeof useNavBadges>;
  collapsed: boolean;
  onNavigate?: () => void;
  section: NavSection;
}): ReactElement {
  return (
    <li>
      <h2
        className={cn(
          "mb-1 truncate px-2.5 font-semibold text-[10.5px] text-muted-foreground/80 uppercase tracking-wider",
          collapsed && "sr-only"
        )}
      >
        {section.title}
      </h2>
      {collapsed ? (
        <div aria-hidden className="mx-2 mb-1 h-px bg-border/70" />
      ) : null}
      <ul className="space-y-0.5">
        {section.items.map((item) => (
          <li key={item.to}>
            <NavLink
              active={activePath === item.to}
              badge={badges[item.to]}
              collapsed={collapsed}
              item={item}
              onNavigate={onNavigate}
            />
          </li>
        ))}
      </ul>
    </li>
  );
}

/**
 * The navigation list: sections of links, filtered to what the signed-in role
 * may open (`app/nav-config.ts`), the current page marked `aria-current`.
 */
export function SidebarNav({
  collapsed = false,
  onNavigate,
}: SidebarNavProps): ReactElement {
  const permissions = usePermissions();
  const badges = useNavBadges();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const activePath = activeNavPath(pathname);

  return (
    <nav aria-label="Main">
      <ul className="space-y-3.5">
        {visibleNav(permissions).map((section) => (
          <NavGroup
            activePath={activePath}
            badges={badges}
            collapsed={collapsed}
            key={section.title}
            onNavigate={onNavigate}
            section={section}
          />
        ))}
      </ul>
    </nav>
  );
}
