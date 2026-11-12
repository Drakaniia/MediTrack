import { cn } from "@cmis/ui/lib/utils";
import type { AppSettings } from "@shared/settings";
import { useBlocker } from "@tanstack/react-router";
import {
  type KeyboardEvent,
  type ReactElement,
  useCallback,
  useState,
} from "react";

import { DataState } from "@/components/data-state";
import { PageHeader } from "@/components/page-header";
import { useCan } from "@/lib/auth/guards";

import { useSettings } from "../hooks/settings-queries";
import { AccountTab } from "./account-tab";
import { AlertsTab } from "./alerts-tab";
import { ConfirmDialog } from "./confirm-dialog";
import { DevicePreferences, FacilitySummary, GeneralTab } from "./general-tab";
import { ThresholdsSummary, ThresholdsTab } from "./thresholds-tab";

export type SettingsTabId = "account" | "alerts" | "general" | "thresholds";

interface TabDefinition {
  adminOnly: boolean;
  id: SettingsTabId;
  label: string;
}

const TABS: readonly TabDefinition[] = [
  { adminOnly: false, id: "general", label: "General" },
  { adminOnly: false, id: "thresholds", label: "Expiry thresholds" },
  { adminOnly: true, id: "alerts", label: "Alerts" },
  { adminOnly: false, id: "account", label: "Account" },
];

const UNSAVED_MESSAGE =
  "You have changes that haven't been saved. If you leave now they will be lost.";

function tabId(id: SettingsTabId): string {
  return `settings-tab-${id}`;
}

function panelId(id: SettingsTabId): string {
  return `settings-panel-${id}`;
}

function TabList({
  active,
  onSelect,
  tabs,
}: {
  active: SettingsTabId;
  onSelect: (id: SettingsTabId) => void;
  tabs: readonly TabDefinition[];
}): ReactElement {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const index = tabs.findIndex((tab) => tab.id === active);
      const last = tabs.length - 1;
      const targets: Record<string, number> = {
        ArrowLeft: index === 0 ? last : index - 1,
        ArrowRight: index === last ? 0 : index + 1,
        End: last,
        Home: 0,
      };
      const target = targets[event.key];
      if (target === undefined) {
        return;
      }
      event.preventDefault();
      onSelect(tabs[target].id);
      document.getElementById(tabId(tabs[target].id))?.focus();
    },
    [active, onSelect, tabs]
  );

  return (
    // Arrow keys move between tabs; each tab is a real button, so Tab/Enter work too.
    <div
      aria-label="Settings sections"
      className="-mx-1 mb-4 flex gap-1 overflow-x-auto border-b px-1"
      onKeyDown={handleKeyDown}
      role="tablist"
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            aria-controls={panelId(tab.id)}
            aria-selected={selected}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
              selected
                ? "border-primary font-semibold text-foreground"
                : "border-transparent text-muted-foreground"
            )}
            id={tabId(tab.id)}
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            role="tab"
            tabIndex={selected ? 0 : -1}
            type="button"
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function AdminTabContent({
  active,
  onDirtyChange,
  settings,
}: {
  active: SettingsTabId;
  onDirtyChange: (dirty: boolean) => void;
  settings: AppSettings;
}): ReactElement | null {
  switch (active) {
    case "general":
      return <GeneralTab onDirtyChange={onDirtyChange} settings={settings} />;
    case "thresholds":
      return (
        <ThresholdsTab onDirtyChange={onDirtyChange} settings={settings} />
      );
    case "alerts":
      return <AlertsTab onDirtyChange={onDirtyChange} settings={settings} />;
    default:
      return null;
  }
}

function ReadOnlyTabContent({
  active,
}: {
  active: SettingsTabId;
}): ReactElement | null {
  switch (active) {
    case "general":
      return (
        <div className="grid gap-4">
          <FacilitySummary />
          <DevicePreferences />
        </div>
      );
    case "thresholds":
      return <ThresholdsSummary />;
    default:
      return null;
  }
}

/**
 * `/settings`: tabs filtered by permission. Administrators edit the facility,
 * thresholds and alerts (`GET/PUT /settings`); everyone else gets a read-only
 * summary built from `/auth/me` (no `/settings` request at all) plus their own
 * Account tab. Leaving a tab or page with unsaved edits asks first.
 */
export function SettingsPage(): ReactElement {
  const canManage = useCan("settings.manage");
  const tabs = TABS.filter((tab) => canManage || !tab.adminOnly);
  const settings = useSettings(canManage);
  const [active, setActive] = useState<SettingsTabId>("general");
  const [pendingTab, setPendingTab] = useState<SettingsTabId | null>(null);
  const [dirty, setDirty] = useState(false);

  const blocker = useBlocker({
    disabled: !dirty,
    enableBeforeUnload: () => dirty,
    shouldBlockFn: () => true,
    withResolver: true,
  });

  const handleSelect = useCallback(
    (id: SettingsTabId) => {
      if (id === active) {
        return;
      }
      if (dirty) {
        setPendingTab(id);
        return;
      }
      setActive(id);
    },
    [active, dirty]
  );

  const handleDiscard = useCallback(() => {
    if (pendingTab) {
      setDirty(false);
      setActive(pendingTab);
    }
    setPendingTab(null);
  }, [pendingTab]);

  const isAccount = active === "account";
  const showAdmin = canManage && !isAccount;

  return (
    <div>
      <PageHeader
        description={
          canManage
            ? "Facility, expiry thresholds, alerts and your own account."
            : "Your account and how this facility is set up."
        }
        title="Settings"
      />
      <TabList active={active} onSelect={handleSelect} tabs={tabs} />
      <div
        aria-labelledby={tabId(active)}
        id={panelId(active)}
        role="tabpanel"
        tabIndex={-1}
      >
        {isAccount ? <AccountTab /> : null}
        {isAccount || canManage ? null : <ReadOnlyTabContent active={active} />}
        {showAdmin ? (
          <DataState
            error={settings.error}
            isLoading={settings.isPending}
            onRetry={() => settings.refetch()}
          >
            {settings.data ? (
              <AdminTabContent
                active={active}
                onDirtyChange={setDirty}
                settings={settings.data}
              />
            ) : null}
          </DataState>
        ) : null}
      </div>
      {pendingTab ? (
        <ConfirmDialog
          cancelLabel="Keep editing"
          confirmLabel="Discard changes"
          description={UNSAVED_MESSAGE}
          destructive
          onCancel={() => setPendingTab(null)}
          onConfirm={handleDiscard}
          title="Discard unsaved changes?"
        />
      ) : null}
      {blocker.status === "blocked" ? (
        <ConfirmDialog
          cancelLabel="Stay on this page"
          confirmLabel="Leave and discard"
          description={UNSAVED_MESSAGE}
          destructive
          onCancel={blocker.reset}
          onConfirm={blocker.proceed}
          title="Discard unsaved changes?"
        />
      ) : null}
    </div>
  );
}
