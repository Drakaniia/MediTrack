import { Button } from "@cmis/ui/components/button";
import { type BatchAction, batchActions } from "@shared/request-transitions";
import type { RequestDto } from "@shared/schemas/requests";
import type { ReactElement } from "react";

export interface RequestsBatchToolbarProps {
  onClear: () => void;
  onRun: (action: BatchAction) => void;
  selected: RequestDto[];
}

/** Appears while cards are selected: the actions that are legal for the whole selection. */
export function RequestsBatchToolbar({
  onClear,
  onRun,
  selected,
}: RequestsBatchToolbarProps): ReactElement | null {
  if (selected.length === 0) {
    return null;
  }
  const actions = batchActions(selected.map((request) => request.status));
  return (
    <div
      aria-label="Batch actions"
      className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2"
      role="toolbar"
    >
      <p aria-live="polite" className="px-1 text-sm">
        {selected.length} selected
      </p>
      {actions.map((action) => (
        <Button
          key={action.id}
          onClick={() => onRun(action)}
          size="sm"
          type="button"
          variant={action.destructive ? "destructive" : "default"}
        >
          {action.label}
        </Button>
      ))}
      <Button onClick={onClear} size="sm" type="button" variant="outline">
        Clear selection
      </Button>
    </div>
  );
}
