import { Label } from "@cmis/ui/components/label";
import { cn } from "@cmis/ui/lib/utils";
import {
  NOTIFICATION_KINDS,
  NOTIFICATION_SEVERITIES,
  type NotificationKind,
  type NotificationSeverity,
} from "@shared/schemas/alerts";
import {
  type KeyboardEvent,
  type ReactElement,
  useCallback,
  useId,
} from "react";

import type { NotificationFilters } from "../hooks/alert-queries";
import { KIND_LABELS, SEVERITY_LABELS } from "../lib/notification-view";

export const NOTIFICATIONS_PANEL_ID = "notifications-panel";

const SELECT_CLASS =
  "h-9 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50";

const TABS = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export interface NotificationFiltersProps {
  filters: NotificationFilters;
  onChange: (next: NotificationFilters) => void;
  unread: number;
}

function Tabs({
  onChange,
  unread,
  unreadOnly,
}: {
  onChange: (unreadOnly: boolean) => void;
  unread: number;
  unreadOnly: boolean;
}): ReactElement {
  const selected: TabId = unreadOnly ? "unread" : "all";
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        const tabs =
          event.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
            '[role="tab"]'
          );
        for (const tab of tabs ?? []) {
          if (tab !== event.currentTarget) {
            tab.focus();
          }
        }
        onChange(selected === "all");
      }
    },
    [onChange, selected]
  );
  return (
    <div
      aria-label="Notification list"
      className="inline-flex gap-1 rounded-full border bg-background p-0.5"
      role="tablist"
    >
      {TABS.map((tab) => {
        const active = tab.id === selected;
        return (
          <button
            aria-controls={NOTIFICATIONS_PANEL_ID}
            aria-selected={active}
            className={cn(
              "tap-target rounded-full px-3 py-1 font-medium text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
            key={tab.id}
            onClick={() => onChange(tab.id === "unread")}
            onKeyDown={handleKeyDown}
            role="tab"
            tabIndex={active ? 0 : -1}
            type="button"
          >
            {tab.label}
            {tab.id === "unread" && unread > 0 ? ` (${unread})` : ""}
          </button>
        );
      })}
    </div>
  );
}

function FilterSelect<T extends string>({
  label,
  labels,
  onChange,
  options,
  value,
}: {
  label: string;
  labels: Record<T, string>;
  onChange: (value: T | "") => void;
  options: readonly T[];
  value: T | "";
}): ReactElement {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        className={SELECT_CLASS}
        id={id}
        onChange={(event) => onChange(event.target.value as T | "")}
        value={value}
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {labels[option]}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Tabs (All / Unread) plus the kind and severity filters of the notifications page. */
export function NotificationFilterBar({
  filters,
  onChange,
  unread,
}: NotificationFiltersProps): ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pb-3">
      <Tabs
        onChange={(unreadOnly) => onChange({ ...filters, unreadOnly })}
        unread={unread}
        unreadOnly={filters.unreadOnly}
      />
      <FilterSelect<NotificationKind>
        label="Type"
        labels={KIND_LABELS}
        onChange={(kind) => onChange({ ...filters, kind })}
        options={NOTIFICATION_KINDS}
        value={filters.kind}
      />
      <FilterSelect<NotificationSeverity>
        label="Severity"
        labels={SEVERITY_LABELS}
        onChange={(severity) => onChange({ ...filters, severity })}
        options={NOTIFICATION_SEVERITIES}
        value={filters.severity}
      />
    </div>
  );
}
