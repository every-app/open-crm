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

/** A column's values as a filter's options, alphabetical. */
export function valueOptions(values: string[] | undefined): FilterOption[] {
  return sort(values ?? [], (a, b) => a.localeCompare(b)).map((value) => ({
    value,
    label: value,
  }));
}

/** Records something happened on in the last 7, 30 or 90 days. */
export function ActivityFilter({
  value,
  onChange,
}: {
  value: number | undefined;
  onChange: (days: (typeof ACTIVITY_DAYS)[number] | undefined) => void;
}) {
  return (
    <FilterChip
      label="Activity"
      icon={Activity}
      single
      options={ACTIVITY_OPTIONS}
      value={value === undefined ? [] : [String(value)]}
      onChange={([picked]) =>
        onChange(ACTIVITY_DAYS.find((days) => String(days) === picked))
      }
    />
  );
}
