import type { ReactNode } from "react";
import { Search } from "lucide-react";
import {
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
import type { RecordListSearch } from "@/client/features/records/listSearch";
import { OwnerFilter } from "@/client/features/records/owners";

// Above a record list's rows: the live/archived view switch, the search, the
// owner filter and the list's actions. Every change goes to the URL and
// takes the list back to its first page.

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
  search,
  onSearchChange,
  placeholder,
  filters,
  actions,
}: {
  search: RecordListSearch;
  onSearchChange: (update: Partial<RecordListSearch>) => void;
  placeholder: string;
  /** After the owner filter: where custom-field filters join. */
  filters?: ReactNode;
  /** On the right: the "Fields" button, and saved views when lists get them. */
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
        />
        {filters}
      </DataTableToolbar>
    </>
  );
}
