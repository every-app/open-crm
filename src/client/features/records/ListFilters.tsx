import { Activity } from "lucide-react";
import { sort } from "remeda";
import {
  FilterChip,
  type FilterOption,
} from "@/client/components/table/FilterChip";
import {
  ACTIVITY_DAYS,
  ACTIVITY_OPTIONS,
} from "@/client/features/records/listSearch";

// Pieces the lists' own filters share.

/** A filter's values for the URL: none takes the param out. */
export function chosen<T>(values: T[]): T[] | undefined {
  return values.length > 0 ? values : undefined;
}

/**
 * A text column's values the list's search finds (its facet counts' keys)
 * as a filter's options, alphabetical.
 */
export function valueOptions(
  counts: Record<string, number> | undefined,
): FilterOption[] {
  return sort(Object.keys(counts ?? {}), (a, b) => a.localeCompare(b)).map(
    (value) => ({ value, label: value }),
  );
}

/** Records something happened on in the last 7, 30 or 90 days. */
export function ActivityFilter({
  value,
  onChange,
  counts,
}: {
  value: number | undefined;
  onChange: (days: (typeof ACTIVITY_DAYS)[number] | undefined) => void;
  counts: Record<string, number> | undefined;
}) {
  return (
    <FilterChip
      label="Activity"
      icon={Activity}
      single
      options={ACTIVITY_OPTIONS}
      counts={counts}
      value={value === undefined ? [] : [String(value)]}
      onChange={([picked]) =>
        onChange(ACTIVITY_DAYS.find((days) => String(days) === picked))
      }
    />
  );
}
