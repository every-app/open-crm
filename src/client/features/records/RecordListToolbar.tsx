import type { ReactNode } from "react";
import { Search } from "lucide-react";
import {
  DataTableTabs,
  DataTableToolbar,
} from "@/client/components/table/DataTableToolbar";
import { countsFor } from "@/client/components/table/FilterChip";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/client/components/ui/input-group";
import { TabsTrigger } from "@/client/components/ui/tabs";
import { useDebouncedDraft } from "@/client/hooks/useDebouncedDraft";
import { FieldFilterChips } from "@/client/features/fields/FieldFilterControls";
import type { RecordListSearch } from "@/client/features/records/listSearch";
import { OwnerFilter } from "@/client/features/records/owners";
import type { FieldEntity } from "@/shared/crm-enums";
import type { FacetCounts } from "@/types/schemas/records";

// Above a record list's rows: the live/archived view switch, then the
// search and the filters (the owner, the list's own, then its custom
// fields'), with the list's actions on the right. Every change goes to the
// URL and takes the list back to its first page. The filters offer the
// values the list's search finds records for, with how many
// (`facetCounts`).

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

export function RecordListToolbar({
  entity,
  search,
  onSearchChange,
  placeholder,
  facetCounts,
  filters,
  actions,
}: {
  /** Whose custom fields the filters offer. */
  entity: FieldEntity;
  search: RecordListSearch;
  onSearchChange: (update: Partial<RecordListSearch>) => void;
  placeholder: string;
  /** The list's counts of its filters' values; undefined while it loads. */
  facetCounts: FacetCounts | undefined;
  /** After the owner filter: the list's own filters. */
  filters?: ReactNode;
  /** On the right: export, saved views, sort, columns and fields. */
  actions?: ReactNode;
}) {
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
          counts={countsFor(facetCounts, "owner")}
        />
        {filters}
        <FieldFilterChips
          entity={entity}
          facetCounts={facetCounts}
          value={search.fields ?? {}}
          onChange={(fields) =>
            onSearchChange({
              fields: Object.keys(fields).length > 0 ? fields : undefined,
              page: undefined,
            })
          }
        />
      </DataTableToolbar>
    </>
  );
}
