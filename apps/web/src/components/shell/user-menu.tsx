import { Button } from "@cmis/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@cmis/ui/components/dropdown-menu";
import { ROLE_LABELS } from "@shared/roles";
import { useNavigate } from "@tanstack/react-router";
import { KeyRound, LogOut, MonitorX } from "lucide-react";
import { useTheme } from "next-themes";
import { type ReactElement, useCallback } from "react";

import { type Density, isDensity, useDensity } from "@/hooks/use-density";
import { LG_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import { useCachedMe } from "@/lib/auth/queries";
import { useSignOut } from "@/lib/auth/use-sign-out";

const WHITESPACE = /\s+/;

const THEME_CHOICES = [
  { label: "System theme", value: "system" },
  { label: "Light theme", value: "light" },
  { label: "Dark theme", value: "dark" },
] as const;

const DENSITY_CHOICES: readonly { label: string; value: Density }[] = [
  { label: "Comfortable density", value: "comfortable" },
  { label: "Compact density", value: "compact" },
];

/** Theme and density as menu radios: the header shows the segmented toggles only from `lg` up. */
function PreferenceGroups(): ReactElement {
  const { setTheme, theme } = useTheme();
  const { density, setDensity } = useDensity();
  const handleDensity = useCallback(
    (value: string) => {
      if (isDensity(value)) {
        setDensity(value);
      }
    },
    [setDensity]
  );
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuRadioGroup onValueChange={setTheme} value={theme ?? "dark"}>
        {THEME_CHOICES.map((choice) => (
          <DropdownMenuRadioItem
            className="tap-target"
            key={choice.value}
            value={choice.value}
          >
            {choice.label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      <DropdownMenuRadioGroup onValueChange={handleDensity} value={density}>
        {DENSITY_CHOICES.map((choice) => (
          <DropdownMenuRadioItem
            className="tap-target"
            key={choice.value}
            value={choice.value}
          >
            {choice.label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  );
}

function initialsOf(name: string): string {
  const letters = name
    .split(WHITESPACE)
    .filter((part) => part !== "")
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase());
  return letters.join("") || "?";
}

/** Signed-in user's menu: who they are, change password, log out (here / everywhere). */
export function UserMenu(): ReactElement | null {
  const { data: me } = useCachedMe();
  const navigate = useNavigate();
  const { isPending, signOut } = useSignOut();
  const isWide = useMediaQuery(LG_QUERY);
  const goToChangePassword = useCallback(
    () => navigate({ to: "/change-password" }),
    [navigate]
  );
  const handleSignOut = useCallback(() => signOut(), [signOut]);
  const handleSignOutEverywhere = useCallback(
    () => signOut({ everywhere: true }),
    [signOut]
  );

  if (!me) {
    return null;
  }
  const { displayName, role } = me.user;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={`Account menu for ${displayName}`}
            className="tap-target gap-2"
            variant="ghost"
          />
        }
      >
        <span
          aria-hidden
          className="flex size-6 items-center justify-center rounded-full bg-primary/15 font-semibold text-[10px] text-primary"
        >
          {initialsOf(displayName)}
        </span>
        <span className="hidden max-w-32 truncate xl:inline">
          {displayName}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="space-y-0.5">
            <span className="block truncate font-medium text-foreground text-sm">
              {displayName}
            </span>
            <span className="block truncate">{ROLE_LABELS[role]}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="tap-target" onClick={goToChangePassword}>
          <KeyRound aria-hidden />
          Change password
        </DropdownMenuItem>
        <DropdownMenuItem
          className="tap-target"
          disabled={isPending}
          onClick={handleSignOut}
        >
          <LogOut aria-hidden />
          Log out
        </DropdownMenuItem>
        <DropdownMenuItem
          className="tap-target"
          disabled={isPending}
          onClick={handleSignOutEverywhere}
        >
          <MonitorX aria-hidden />
          Log out everywhere
        </DropdownMenuItem>
        {isWide ? null : <PreferenceGroups />}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
