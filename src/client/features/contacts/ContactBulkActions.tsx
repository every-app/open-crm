import { useEffect, useState } from "react";
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { MenuSearchInput } from "@/client/components/table/FiltersMenu";
import { ComboboxItem, ComboboxList } from "@/client/components/ui/combobox";
import { companyOptionsQueryOptions } from "@/client/features/companies/companyQueries";
import { invalidateContacts } from "@/client/features/contacts/useContactMutations";
import {
  BulkSubmenu,
  RecordBulkMenu,
  reportBulk,
  type RecordNoun,
} from "@/client/features/records/RecordBulkMenu";
import {
  bulkArchiveContacts,
  bulkAssignContactOwner,
  bulkEnrichContacts,
  bulkPurgeContacts,
  bulkRestoreContacts,
  bulkSetContactCompany,
} from "@/serverFunctions/contacts";
import { NO_COMPANY } from "@/types/schemas/contacts";
import type { BulkResult } from "@/types/schemas/records";

const NOUN: RecordNoun = { one: "contact", many: "contacts" };

const SEARCH_DELAY_MS = 250;

/** What the contacts list does to its selected rows. */
export function ContactBulkActions({
  ids,
  archived,
  canPurge,
  onDone,
}: {
  ids: string[];
  archived: boolean;
  canPurge: boolean;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  // A pick in Move to company's search closes the whole menu.
  const [menuOpen, setMenuOpen] = useState(false);
  const settled = (done: (count: string) => string) => ({
    onSuccess: async (result: BulkResult) => {
      reportBulk(result, NOUN, done);
      onDone();
      await invalidateContacts(queryClient);
    },
  });

  const assign = useMutation({
    mutationFn: (input: { ids: string[]; ownerId: string | null }) =>
      bulkAssignContactOwner({ data: input }),
    ...settled((count) => `${count} reassigned.`),
  });
  const move = useMutation({
    mutationFn: (input: { ids: string[]; companyId: string | null }) =>
      bulkSetContactCompany({ data: input }),
    ...settled((count) => `${count} moved.`),
  });
  const enrich = useMutation({
    mutationFn: (selected: string[]) =>
      bulkEnrichContacts({ data: { ids: selected } }),
    ...settled((count) => `Looking up ${count}.`),
  });
  const archive = useMutation({
    mutationFn: (selected: string[]) =>
      bulkArchiveContacts({ data: { ids: selected } }),
    ...settled((count) => `${count} archived.`),
  });
  const restore = useMutation({
    mutationFn: (selected: string[]) =>
      bulkRestoreContacts({ data: { ids: selected } }),
    ...settled((count) => `${count} restored.`),
  });
  const purge = useMutation({
    mutationFn: (selected: string[]) =>
      bulkPurgeContacts({ data: { ids: selected } }),
    ...settled((count) => `${count} deleted forever.`),
  });

  return (
    <RecordBulkMenu
      noun={NOUN}
      count={ids.length}
      archived={archived}
      canPurge={canPurge}
      pending={[assign, move, enrich, archive, restore, purge].some(
        (mutation) => mutation.isPending,
      )}
      open={menuOpen}
      onOpenChange={setMenuOpen}
      onAssignOwner={(ownerId) => assign.mutate({ ids, ownerId })}
      onEnrich={() => enrich.mutate(ids)}
      onArchive={() => archive.mutate(ids)}
      onRestore={() => restore.mutate(ids)}
      onPurge={() => purge.mutate(ids)}
      purgeWarning="This cannot be undone, and the inbox sync will not file them again."
    >
      <BulkSubmenu
        icon={Building2}
        label="Move to company"
        className="w-64 p-0"
      >
        <CompanySearch
          onPick={(companyId) => {
            setMenuOpen(false);
            move.mutate({ ids, companyId });
          }}
        />
      </BulkSubmenu>
    </RecordBulkMenu>
  );
}

type CompanyItem = { id: string; name: string; domain: string | null };

/**
 * Move to company's submenu: "No company", then the live companies; typing
 * searches them on the server.
 */
function CompanySearch({
  onPick,
}: {
  onPick: (companyId: string | null) => void;
}) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(
      () => setQuery(input.trim()),
      SEARCH_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [input]);
  const found = useQuery(companyOptionsQueryOptions(query));
  const searching = found.isFetching || input.trim() !== query;
  const items: CompanyItem[] = [
    ...(query ? [] : [{ id: NO_COMPANY, name: "No company", domain: null }]),
    ...(found.data ?? []),
  ];

  return (
    <ComboboxPrimitive.Root
      inline
      open
      items={items}
      onValueChange={(company: CompanyItem | null) => {
        if (company) onPick(company.id === NO_COMPANY ? null : company.id);
      }}
      onInputValueChange={setInput}
      itemToStringLabel={(company: CompanyItem) => company.name}
      // The server already matched the search.
      filter={null}
    >
      <MenuSearchInput placeholder="Search companies…" searching={searching} />
      <ComboboxPrimitive.Empty>
        <p className="px-3 py-5 text-center text-sm text-muted-foreground">
          {searching ? "Searching…" : "No company matches."}
        </p>
      </ComboboxPrimitive.Empty>
      <ComboboxList className="max-h-64">
        {(company: CompanyItem) => (
          // Nothing is ever chosen here, so no room for a check mark.
          <ComboboxItem key={company.id} value={company} className="pr-2">
            <span className="max-w-full shrink-0 truncate">{company.name}</span>
            {company.domain ? (
              <span className="ml-auto min-w-0 truncate pl-2 text-xs text-muted-foreground">
                {company.domain}
              </span>
            ) : null}
          </ComboboxItem>
        )}
      </ComboboxList>
    </ComboboxPrimitive.Root>
  );
}
