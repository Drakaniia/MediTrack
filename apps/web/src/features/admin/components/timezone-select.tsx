import { Input } from "@cmis/ui/components/input";
import { Label } from "@cmis/ui/components/label";
import {
  type ChangeEvent,
  type ReactElement,
  useCallback,
  useId,
  useMemo,
  useState,
} from "react";

import { useMinuteClock } from "@/lib/clock";

import {
  filterTimeZones,
  listTimeZones,
  localTimePreview,
} from "../lib/timezones";

export interface TimezoneSelectProps {
  error?: string;
  onValueChange: (timeZone: string) => void;
  value: string;
}

/**
 * Searchable IANA timezone picker: a search box above a native listbox (so
 * keyboards, screen readers and phones all work), and a live preview of what the
 * wall clock reads in the chosen zone.
 */
export function TimezoneSelect({
  error,
  onValueChange,
  value,
}: TimezoneSelectProps): ReactElement {
  const searchId = useId();
  const listId = useId();
  const noteId = useId();
  const [query, setQuery] = useState("");
  const clock = useMinuteClock();
  const zones = useMemo(() => listTimeZones([value]), [value]);
  const matches = useMemo(() => filterTimeZones(zones, query), [zones, query]);

  const handleSearch = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value),
    []
  );
  const handleSelect = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) =>
      onValueChange(event.target.value),
    [onValueChange]
  );

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={searchId}>Timezone</Label>
      <Input
        aria-controls={listId}
        className="h-9"
        id={searchId}
        onChange={handleSearch}
        placeholder="Search, e.g. Manila or New York"
        type="search"
        value={query}
      />
      <select
        aria-describedby={noteId}
        aria-invalid={error ? true : undefined}
        aria-label="Timezones"
        className="w-full rounded-none border border-input bg-background p-1 text-xs outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50"
        id={listId}
        onChange={handleSelect}
        size={6}
        value={value}
      >
        {matches.map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </select>
      {matches.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          No timezone matches “{query}”.
        </p>
      ) : null}
      <p aria-live="polite" className="text-xs" id={noteId}>
        <span className="font-medium">{value}</span>
        <span className="text-muted-foreground">
          {" "}
          — it is {localTimePreview(new Date(clock), value)} there now
        </span>
      </p>
      <p className="text-muted-foreground text-xs">
        Decides what “today” is, the month boundaries in reports and when the
        daily alert job runs.
      </p>
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}
