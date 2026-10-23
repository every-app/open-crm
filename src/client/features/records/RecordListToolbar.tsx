import type { ReactNode } from "react";
import type { Table } from "@tanstack/react-table";
import { Search, Archive, SlidersHorizontal } from "lucide-react";
import { useIsMobile } from "@/client/hooks/use-mobile";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/client/components/ui/sheet";
import { ColumnsMenu } from "@/client/components/table/ColumnsMenu";
import {
  FilterTokens,
  FiltersMenu,
  countsFor,
  type ListFilter,
} from "@/client/components/table/FiltersMenu";
import { SortMenu } from "@/client/components/table/SortMenu";
import { Button } from "@/client/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/client/components/ui/input-group";
import { useDebouncedDraft } from "@/client/hooks/useDebouncedDraft";
import { useFieldFilters } from "@/client/features/fields/FieldFilterControls";
import { useOpenFieldsSheet } from "@/client/features/fields/FieldsSheetButton";
import {
  clearedFilters,
  savedViewOf,
  type RecordListSearch,
} from "@/client/features/records/listSearch";
import { useOwnerFilter } from "@/client/features/records/owners";
import { SavedViewsMenu } from "@/client/features/saved-views/SavedViewsMenu";
import type { FieldEntity } from "@/shared/crm-enums";
import type { SavedViewFilters } from "@/types/schemas/saved-views";
import type { FacetCounts } from "@/types/schemas/records";

// Above a record list's rows: search and the Filters menu (archive, owner,
// the list's own filters,
// then its custom fields'), and the saved views, sort and columns on the
// right; under it, while any filter is set, a token for each. Every change
// goes to the URL and takes the list back to its first page. The filters
// offer the values the list's search finds records for, with how many
// (`facetCounts`). While rows are selected, their count, the list's Actions
// menu and Clear take the place of the toolbar and its tokens.

const trim = (value: string) => value.trim();

function ListSearchInput({
  value,
  placeholder,
  onCommit,
}: {
  value: string;
  placeholder: string;
  onCommit: (value: string) => void;
}) {
  // Typing stays local and reaches the URL after a pause.
  const [draft, setDraft] = useDebouncedDraft(value, onCommit, trim);
  return (
    <InputGroup className="h-7 w-full sm:w-80">
      <InputGroupAddon>
        <Search />
      </InputGroupAddon>
      <InputGroupInput
        type="search"
        aria-label={placeholder}
        placeholder={placeholder}
        value={draft}
        autoComplete="off"
        onChange={(event) => setDraft(event.target.value)}
      />
    </InputGroup>
  );
}

export function RecordListToolbar<TData>({
  entity,
  table,
  search,
  onSearchChange,
  onApplyView,
  placeholder,
  facetCounts,
  filters,
  filterKeys,
  selection,
}: {
  /** Whose custom fields the filters and the fields sheet offer. */
  entity: FieldEntity;
  table: Table<TData>;
  search: RecordListSearch;
  onSearchChange: (update: Partial<RecordListSearch>) => void;
  /** Applies a view chosen in Views. */
  onApplyView: (filters: SavedViewFilters) => void;
  placeholder: string;
  /** The list's counts of its filters' values; undefined while it loads. */
  facetCounts: FacetCounts | undefined;
  /** After the owner filter: the list's own filters. */
  filters: ListFilter[];
  /** The URL params the list filters by, its search included. */
  filterKeys: readonly string[];
  /** The selected rows: how many, the list's Actions menu, and Clear. */
  selection: { count: number; actions: ReactNode; onClear: () => void };
}) {
  const mobile = useIsMobile();
  const openFieldsSheet = useOpenFieldsSheet();
  const owner = useOwnerFilter(
    search.owner ?? [],
    (next) =>
      onSearchChange({
        owner: next.length > 0 ? next : undefined,
        page: undefined,
      }),
    countsFor(facetCounts, "owner"),
  );
  const fieldFilters = useFieldFilters(
    entity,
    facetCounts,
    search.fields ?? {},
    (fields) =>
      onSearchChange({
        fields: Object.keys(fields).length > 0 ? fields : undefined,
        page: undefined,
      }),
  );
  const archive: ListFilter = {
    key: "archived",
    label: "Archived records",
    icon: Archive,
    bare: true,
    single: true,
    options: [{ value: "archived", label: "Archived records" }],
    value: search.archived ? ["archived"] : [],
    onChange: (values) =>
      onSearchChange({
        archived: values.includes("archived") || undefined,
        page: undefined,
      }),
  };
  const all = [owner, ...filters, ...fieldFilters, archive];
  // Every filter, but not the search.
  const clearFilters = () =>
    onSearchChange({
      ...clearedFilters(filterKeys.filter((key) => key !== "q")),
      archived: undefined,
    });
  const selecting = selection.count > 0;

  return (
    <>
      <div className="relative border-b border-border">
        {/* Under a selection the toolbar stays mounted and keeps its
            height, so the rows don't move under the pointer. */}
        <div className={selecting ? "invisible" : undefined}>
          <div className="flex flex-wrap items-center gap-2 px-4 py-3">
            <ListSearchInput
              value={search.q ?? ""}
              placeholder={placeholder}
              onCommit={(q) =>
                onSearchChange({ q: q || undefined, page: undefined })
              }
            />
            <FiltersMenu filters={all} onClear={clearFilters} />
            <div className="ml-auto flex items-center gap-2">
              {mobile ? (
                <Sheet>
                  <SheetTrigger render={<Button variant="outline" size="sm" />}>
                    <SlidersHorizontal data-icon="inline-start" />
                    View options
                  </SheetTrigger>
                  <SheetContent className="w-full sm:max-w-sm">
                    <SheetHeader>
                      <SheetTitle>View options</SheetTitle>
                    </SheetHeader>
                    <div className="flex flex-wrap gap-3 px-4">
                      <SavedViewsMenu
                        entity={entity}
                        current={savedViewOf(search)}
                        onApply={onApplyView}
                        showLabel
                      />
                      <SortMenu table={table} showLabel />
                      <ColumnsMenu
                        table={table}
                        onEditFields={() => openFieldsSheet(entity)}
                        showLabel
                      />
                    </div>
                  </SheetContent>
                </Sheet>
              ) : (
                <>
                  <SavedViewsMenu
                    entity={entity}
                    current={savedViewOf(search)}
                    onApply={onApplyView}
                  />
                  <SortMenu table={table} />
                  <ColumnsMenu
                    table={table}
                    onEditFields={() => openFieldsSheet(entity)}
                  />
                </>
              )}
            </div>
          </div>
          <FilterTokens filters={all} onClear={clearFilters} />
        </div>
        {selecting ? (
          <div className="absolute inset-0 flex items-center gap-2 px-4">
            <span className="text-[0.8rem] text-muted-foreground">
              <span className="font-medium text-foreground tabular-nums">
                {selection.count.toLocaleString()}
              </span>{" "}
              selected
            </span>
            <div className="ml-auto flex items-center gap-2">
              {selection.actions}
              <Button variant="ghost" size="sm" onClick={selection.onClear}>
                Clear
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
