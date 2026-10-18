import { useState, type ReactNode } from "react";
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { ChevronDown, Search, X, type LucideIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/client/components/ui/button";
import { ComboboxItem, ComboboxList } from "@/client/components/ui/combobox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { Spinner } from "@/client/components/ui/spinner";
import type { FacetCounts } from "@/types/schemas/records";

// A list's filters, above its rows: each a compact outline button with an
// icon, the filter's name (or, once set, its value) and a chevron, opening a
// popover. A set filter has a button beside it that clears it.

export type FilterOption = { value: string; label: string };

/**
 * One filter's counts from a list's facet counts: undefined while the list
 * loads; a value they don't name has no records.
 */
export function countsFor(
  facetCounts: FacetCounts | undefined,
  filter: string,
): Record<string, number> | undefined {
  return facetCounts ? (facetCounts[filter] ?? {}) : undefined;
}

/**
 * One filter's button and popover. `summary` is its value as the button
 * shows it, undefined while the filter is off; `children` is the popover.
 */
export function FilterChipShell({
  label,
  icon: Icon,
  summary,
  open,
  onOpenChange,
  onClear,
  children,
}: {
  label: string;
  icon: LucideIcon;
  summary: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClear: () => void;
  children: ReactNode;
}) {
  const active = summary !== undefined;
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <div className="inline-flex">
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              aria-label={active ? `${label}: ${summary}` : label}
              className={cn(active && "rounded-r-none")}
            />
          }
        >
          <Icon data-icon="inline-start" />
          <span className="max-w-44 truncate">{summary ?? label}</span>
          <ChevronDown
            data-icon="inline-end"
            className="text-muted-foreground"
          />
        </PopoverTrigger>
        {active ? (
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={`Clear ${label.toLowerCase()}`}
            className="-ml-px rounded-l-none"
            onClick={onClear}
          >
            <X />
          </Button>
        ) : null}
      </div>
      <PopoverContent align="start" className="w-64 overflow-hidden p-0">
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** "Acme", or "Acme +2" when more are chosen. */
function summaryOf(
  value: string[],
  labelOf: (value: string) => string,
): string | undefined {
  const [first] = value;
  if (first === undefined) return undefined;
  return value.length > 1
    ? `${labelOf(first)} +${value.length - 1}`
    : labelOf(first);
}

/**
 * A filter on a list of values: a search field over the options, each with
 * a check mark when chosen, the chosen ones first. `single` takes one value
 * at a time; `onSearch` searches on the server instead of within `options`
 * (which must then hold the chosen values too, to name them). With
 * `counts` (the list's facet counts for the filter), it offers only the
 * options the list's search finds records for, each with how many.
 */
export function FilterChip({
  label,
  icon,
  options,
  value,
  onChange,
  counts,
  single = false,
  max,
  onSearch,
  searching = false,
  emptyLabel = "Nothing matches.",
  renderOption,
}: {
  label: string;
  icon: LucideIcon;
  options: FilterOption[];
  value: string[];
  onChange: (next: string[]) => void;
  /** Records per option; undefined while the list loads. */
  counts?: Record<string, number>;
  single?: boolean;
  /** The most values it takes at once. */
  max?: number;
  onSearch?: (query: string) => void;
  searching?: boolean;
  emptyLabel?: string;
  renderOption?: (option: FilterOption) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // The chosen values as the popover opened: they stay on top while it's
  // open, so a pick doesn't move the rows under the pointer.
  const [pinned, setPinned] = useState<string[]>([]);
  const labelOf = (wanted: string) =>
    options.find((option) => option.value === wanted)?.label ?? wanted;
  const items = [
    ...pinned.map((pin) => ({ value: pin, label: labelOf(pin) })),
    ...options.filter(
      (option) =>
        !pinned.includes(option.value) &&
        (counts === undefined || (counts[option.value] ?? 0) > 0),
    ),
  ];
  const full = max !== undefined && value.length >= max;

  const show = (next: boolean) => {
    if (next) setPinned(value);
    setOpen(next);
  };

  return (
    <FilterChipShell
      label={label}
      icon={icon}
      summary={summaryOf(value, labelOf)}
      open={open}
      onOpenChange={show}
      onClear={() => onChange([])}
    >
      <ComboboxPrimitive.Root
        inline
        open={open}
        onOpenChange={(next) => {
          if (!next) show(false);
        }}
        multiple
        items={items}
        value={items.filter((item) => value.includes(item.value))}
        onValueChange={(next) => {
          const picked = next.map((item) => item.value);
          if (!single) return onChange(picked);
          // One at a time: a new pick replaces the old one.
          const added = picked.filter((pick) => !value.includes(pick));
          onChange(added.length > 0 ? added.slice(-1) : picked);
          show(false);
        }}
        onInputValueChange={onSearch}
        filter={onSearch ? null : undefined}
        isItemEqualToValue={(item, chosen) => item.value === chosen.value}
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          {searching ? (
            <Spinner className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <Search
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground"
            />
          )}
          <ComboboxPrimitive.Input
            placeholder={`Search ${label.toLowerCase()}…`}
            className="h-9 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <ComboboxPrimitive.Empty>
          <p className="px-3 py-5 text-center text-sm text-muted-foreground">
            {searching ? "Searching…" : emptyLabel}
          </p>
        </ComboboxPrimitive.Empty>
        <ComboboxList className="max-h-64">
          {(item: FilterOption) => (
            <ComboboxItem
              key={item.value}
              value={item}
              disabled={full && !single && !value.includes(item.value)}
            >
              <span className="min-w-0 truncate">
                {renderOption ? renderOption(item) : item.label}
              </span>
              {counts ? (
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {counts[item.value] ?? 0}
                </span>
              ) : null}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPrimitive.Root>
    </FilterChipShell>
  );
}
