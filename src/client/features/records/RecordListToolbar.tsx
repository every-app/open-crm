import { useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import {
  DataTableFilterPanel,
  DataTableFilterToggle,
  DataTableTabs,
  DataTableToolbar,
} from "@/client/components/table/DataTableToolbar";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/client/components/ui/input-group";
import { TabsTrigger } from "@/client/components/ui/tabs";
import { useDebouncedDraft } from "@/client/hooks/useDebouncedDraft";
import {
  FieldFilterControls,
  useFilterableFields,
} from "@/client/features/fields/FieldFilterControls";
import type { RecordListSearch } from "@/client/features/records/listSearch";
import { OwnerFilter } from "@/client/features/records/owners";
import type { FieldEntity } from "@/shared/crm-enums";
import type { FieldFilters } from "@/types/schemas/fields";

// Above a record list's rows: the live/archived view switch, the search, the
// owner filter, the list's own filters and actions, and a panel of custom
// field filters. Every change goes to the URL and takes the list back to its
// first page.

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
    <InputGroup className="w-full sm:w-72">
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

export function RecordListToolbar({
  entity,
  search,
  onSearchChange,
  placeholder,
  filters,
  actions,
}: {
  /** Whose custom fields the filter panel offers. */
  entity: FieldEntity;
  search: RecordListSearch;
  onSearchChange: (update: Partial<RecordListSearch>) => void;
  placeholder: string;
  /** After the owner filter: the list's own filters. */
  filters?: ReactNode;
  /** On the right: saved views and the "Fields" button. */
  actions?: ReactNode;
}) {
  const fieldFilters = search.fields ?? {};
  const filterable = useFilterableFields(entity, fieldFilters);
  // Open from the start when the URL (a link, a reload) filters by fields.
  const [panelOpen, setPanelOpen] = useState(
    () => Object.keys(fieldFilters).length > 0,
  );
  const setFieldFilters = (next: FieldFilters) =>
    onSearchChange({
      fields: Object.keys(next).length > 0 ? next : undefined,
      page: undefined,
    });
  const hasFieldFilters = filterable.fields.length > 0;

  return (
    <>
      <DataTableTabs
        value={search.archived ? "archived" : "live"}
        onValueChange={(view) =>
          onSearchChange({
            archived: view === "archived" || undefined,
            page: undefined,
          })
        }
      >
        <TabsTrigger value="live">Active</TabsTrigger>
        <TabsTrigger value="archived">Archived</TabsTrigger>
      </DataTableTabs>
      <DataTableToolbar actions={actions}>
        <ListSearchInput
          value={search.q ?? ""}
          placeholder={placeholder}
          onCommit={(q) =>
            onSearchChange({ q: q || undefined, page: undefined })
          }
        />
        <OwnerFilter
          value={search.owner ?? []}
          onChange={(owner) =>
            onSearchChange({
              owner: owner.length > 0 ? owner : undefined,
              page: undefined,
            })
          }
        />
        {filters}
        {hasFieldFilters ? (
          <DataTableFilterToggle
            open={panelOpen}
            activeCount={filterable.activeCount}
            onToggle={() => setPanelOpen(!panelOpen)}
          />
        ) : null}
      </DataTableToolbar>
      {panelOpen && hasFieldFilters ? (
        <DataTableFilterPanel
          activeCount={filterable.activeCount}
          onReset={() => setFieldFilters({})}
        >
          <FieldFilterControls
            fields={filterable.fields}
            value={fieldFilters}
            onChange={setFieldFilters}
          />
        </DataTableFilterPanel>
      ) : null}
    </>
  );
}
