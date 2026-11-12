import { Button } from "@cmis/ui/components/button";
import { Input } from "@cmis/ui/components/input";
import { Label } from "@cmis/ui/components/label";
import {
  REQUEST_DATE_PRESETS,
  type RequestDatePreset,
} from "@shared/schemas/requests";
import type { ReactElement } from "react";
import { useId } from "react";

import type { RequestFilterState } from "../hooks/use-request-filters";
import { DATE_PRESET_LABELS } from "../lib/request-view";
import { NATIVE_SELECT_CLASS } from "./form-parts";

function isPreset(value: string): value is RequestDatePreset {
  return (REQUEST_DATE_PRESETS as readonly string[]).includes(value);
}

/** Search, date range and "my requests" for the board. */
export function RequestsFilterBar({
  state,
}: {
  state: RequestFilterState;
}): ReactElement {
  const searchId = useId();
  const presetId = useId();
  const fromId = useId();
  const toId = useId();
  const mineId = useId();
  const { filters } = state;

  return (
    <search className="flex flex-wrap items-end gap-3 pb-3">
      <div className="grid min-w-52 flex-1 gap-1">
        <Label htmlFor={searchId}>Search requests</Label>
        <Input
          autoComplete="off"
          id={searchId}
          onChange={(event) => state.setSearchText(event.target.value)}
          placeholder="Code, item or requestor"
          type="search"
          value={state.searchText}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor={presetId}>Submitted</Label>
        <select
          className={NATIVE_SELECT_CLASS}
          id={presetId}
          onChange={(event) => {
            const { value } = event.target;
            if (isPreset(value)) {
              state.patch({ datePreset: value });
            }
          }}
          value={filters.datePreset}
        >
          {REQUEST_DATE_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {DATE_PRESET_LABELS[preset]}
            </option>
          ))}
        </select>
      </div>
      {filters.datePreset === "custom" ? (
        <>
          <div className="grid gap-1">
            <Label htmlFor={fromId}>From</Label>
            <Input
              id={fromId}
              onChange={(event) => state.patch({ from: event.target.value })}
              type="date"
              value={filters.from}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor={toId}>To</Label>
            <Input
              id={toId}
              onChange={(event) => state.patch({ to: event.target.value })}
              type="date"
              value={filters.to}
            />
          </div>
        </>
      ) : null}
      <div className="flex h-8 items-center gap-2">
        <input
          checked={filters.mine}
          className="size-4"
          id={mineId}
          onChange={(event) => state.patch({ mine: event.target.checked })}
          type="checkbox"
        />
        <Label htmlFor={mineId}>My requests</Label>
      </div>
      {state.isFiltered ? (
        <Button onClick={state.reset} type="button" variant="outline">
          Clear filters
        </Button>
      ) : null}
    </search>
  );
}
