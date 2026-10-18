import { useState, type KeyboardEvent, type ReactNode } from "react";
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import {
  ChevronDown,
  ListFilterIcon,
  Search,
  X,
  type LucideIcon,
} from "lucide-react";
import { RowCheckbox } from "@/client/components/table/RowCheckbox";
import { filterSummary } from "@/client/components/table/filterSummary";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { ComboboxList } from "@/client/components/ui/combobox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { Spinner } from "@/client/components/ui/spinner";
import { useIsMobile } from "@/client/hooks/use-mobile";
import type { FacetCounts } from "@/types/schemas/records";

// A list's filters: one "Filters" menu above its rows, each filter a submenu
// of its values, and a row of tokens under the toolbar for the ones that are
// set, each removable.

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
 * A filter on a list of values: its submenu offers a search over the
 * options, each checked when chosen, the chosen ones first. `single` takes
 * one value at a time; `onSearch` searches on the server instead of within
 * `options` (which must then hold the chosen values too, to name them).
 * With `counts` (the list's facet counts for the filter), it offers only
 * the options the list's search finds records for, each with how many.
 */
export type ListFilter = {
  /** Unique within the list. */
  key: string;
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
  /**
   * The submenu's own content in place of the options, such as inputs for
   * text it contains or a range. `value` then holds what the filter is set
   * to, as its token reads it, and `onChange([])` clears it.
   */
  panel?: ReactNode;
  /** A custom field's, offered under "Custom fields". */
  custom?: boolean;
  /** Its token reads like its option, without "<label> is". */
  bare?: boolean;
};

const isSet = (filter: ListFilter) => filter.value.length > 0;

/**
 * Keys typed into a submenu's fields stay there: the menus around them must
 * not read letters as typeahead or arrows as moves. Escape still closes it.
 */
function keepKeys(event: KeyboardEvent) {
  if (event.key !== "Escape" && event.key !== "Tab") event.stopPropagation();
}

/** A value's label among the filter's options, or the value itself. */
function labelOf(filter: ListFilter, value: string): string {
  return (
    filter.options.find((option) => option.value === value)?.label ?? value
  );
}

/**
 * The toolbar's "Filters" button, with how many filters are set, opening
 * the list's filters (the custom fields' under their own heading) and a way
 * to clear them all.
 */
export function FiltersMenu({
  filters,
  onClear,
}: {
  filters: ListFilter[];
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  // A phone has no hover, and a submenu there covers the filters under it:
  // a tap opens it and another tap closes it.
  const tapToOpen = useIsMobile();
  const active = filters.filter(isSet).length;
  const own = filters.filter((filter) => !filter.custom);
  const custom = filters.filter((filter) => filter.custom);
  const submenu = (filter: ListFilter) => (
    <FilterSubmenu
      key={filter.key}
      filter={filter}
      openOnHover={!tapToOpen}
      onPicked={() => setOpen(false)}
    />
  );
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        <ListFilterIcon data-icon="inline-start" />
        Filters
        {active > 0 ? (
          <Badge size="sm" className="min-w-4 px-1 tabular-nums">
            {active}
          </Badge>
        ) : null}
        <ChevronDown data-icon="inline-end" className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {own.map(submenu)}
        {custom.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Custom fields</DropdownMenuLabel>
              {custom.map(submenu)}
            </DropdownMenuGroup>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={active === 0} onClick={onClear}>
          Clear filters
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FilterSubmenu({
  filter,
  openOnHover,
  onPicked,
}: {
  filter: ListFilter;
  openOnHover: boolean;
  /** After a pick on a one-value filter: the menu closes, as a chip did. */
  onPicked: () => void;
}) {
  const Icon = filter.icon;
  return (
    <DropdownMenuSub
      // A server search starts over the next time the submenu opens.
      onOpenChange={(open) => {
        if (!open) filter.onSearch?.("");
      }}
    >
      <DropdownMenuSubTrigger
        openOnHover={openOnHover}
        className="[&>svg:last-child]:text-muted-foreground"
      >
        <Icon className="text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{filter.label}</span>
        {isSet(filter) ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            {filter.value.length}
          </span>
        ) : null}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-64 p-0">
        {filter.panel ? (
          <div className="p-2" onKeyDown={keepKeys}>
            {filter.panel}
          </div>
        ) : (
          <FilterOptions filter={filter} onPicked={onPicked} />
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function FilterOptions({
  filter,
  onPicked,
}: {
  filter: ListFilter;
  onPicked: () => void;
}) {
  const {
    label,
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
  } = filter;
  // The chosen values as the submenu opened: they stay on top while it's
  // open, so a pick doesn't move the rows under the pointer.
  const [pinned] = useState(value);
  const items = [
    ...pinned.map((pin) => ({ value: pin, label: labelOf(filter, pin) })),
    ...options.filter(
      (option) =>
        !pinned.includes(option.value) &&
        (counts === undefined || (counts[option.value] ?? 0) > 0),
    ),
  ];
  const full = max !== undefined && value.length >= max;

  return (
    <ComboboxPrimitive.Root
      inline
      open
      multiple
      items={items}
      value={items.filter((item) => value.includes(item.value))}
      onValueChange={(next) => {
        const picked = next.map((item) => item.value);
        if (!single) return onChange(picked);
        // One at a time: a new pick replaces the old one.
        const added = picked.filter((pick) => !value.includes(pick));
        onChange(added.length > 0 ? added.slice(-1) : picked);
        onPicked();
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
          autoFocus
          placeholder={`Search ${label.toLowerCase()}…`}
          onKeyDown={keepKeys}
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
          <ComboboxPrimitive.Item
            key={item.value}
            value={item}
            disabled={full && !single && !value.includes(item.value)}
            className="group/check flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-foreground"
          >
            <RowCheckbox />
            <span className="min-w-0 truncate">
              {renderOption ? renderOption(item) : item.label}
            </span>
            {counts ? (
              <span className="ml-auto pl-2 text-xs text-muted-foreground tabular-nums">
                {counts[item.value] ?? 0}
              </span>
            ) : null}
          </ComboboxPrimitive.Item>
        )}
      </ComboboxList>
    </ComboboxPrimitive.Root>
  );
}

/**
 * Under the toolbar while any filter is set: one token per set filter,
 * "<Filter> is <values>", each with a way to remove it, and "Clear" for
 * them all.
 */
export function FilterTokens({
  filters,
  onClear,
}: {
  filters: ListFilter[];
  onClear: () => void;
}) {
  const set = filters.filter(isSet);
  if (set.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
      {set.map((filter) => (
        <span
          key={filter.key}
          className="inline-flex h-6.5 max-w-full items-center gap-0.5 rounded-md border border-primary/15 bg-primary/[0.07] pr-0.5 pl-2 text-[0.8rem]"
        >
          <span className="min-w-0 truncate">
            {filter.bare ? null : (
              <span className="text-muted-foreground">{filter.label} is </span>
            )}
            {filterSummary(filter.value.map((value) => labelOf(filter, value)))}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Clear ${filter.label.toLowerCase()}`}
            className="size-5 text-muted-foreground hover:bg-primary/10"
            onClick={() => filter.onChange([])}
          >
            <X />
          </Button>
        </span>
      ))}
      <Button
        variant="ghost"
        size="xs"
        className="text-[0.8rem] font-normal text-muted-foreground"
        onClick={onClear}
      >
        Clear
      </Button>
    </div>
  );
}
