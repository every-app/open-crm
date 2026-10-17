import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import type { SortingState } from "@tanstack/react-table";
import { Plus, Upload, Users } from "lucide-react";
import { findLast } from "remeda";
import { PageHeader } from "@/client/components/PageHeader";
import { QueryError } from "@/client/components/QueryState";
import { ColumnsMenu } from "@/client/components/table/ColumnsMenu";
import {
  DataTable,
  useDataTable,
  useSelectionAnchor,
} from "@/client/components/table/DataTable";
import { TablePagination } from "@/client/components/table/TablePagination";
import { Button } from "@/client/components/ui/button";
import { ContactBulkActions } from "@/client/features/contacts/ContactBulkActions";
import { ContactFilters } from "@/client/features/contacts/ContactFilters";
import { CreateContactDialog } from "@/client/features/contacts/CreateContactDialog";
import {
  CONTACT_HIDDEN_COLUMNS,
  contactColumns,
} from "@/client/features/contacts/contactColumns";
import { contactListQueryOptions } from "@/client/features/contacts/contactQueries";
import type { ContactRow } from "@/client/features/contacts/contactFormat";
import {
  CONTACT_FILTER_KEYS,
  contactListInput,
  contactListSearchSchema,
  type ContactListSearch,
} from "@/client/features/contacts/contactSearch";
import { FieldsSheetButton } from "@/client/features/fields/FieldsSheetButton";
import { useFieldColumns } from "@/client/features/fields/fieldColumns";
import { ExportButton } from "@/client/features/csv/ExportButton";
import { ImportDialog } from "@/client/features/csv/ImportDialog";
import { CONTACT_EXPORT } from "@/client/features/csv/exportColumns";
import { RecordListToolbar } from "@/client/features/records/RecordListToolbar";
import {
  clearedFilters,
  columnVisibility,
  isListFiltered,
  savedViewOf,
  searchFromSavedView,
  useListSelection,
} from "@/client/features/records/listSearch";
import { useRecordStack } from "@/client/features/records/recordStack";
import { SavedViewsMenu } from "@/client/features/saved-views/SavedViewsMenu";
import { workspaceQueryOptions } from "@/client/features/workspace/workspaceQueries";
import { listContacts } from "@/serverFunctions/contacts";
import { hasOrgPermission } from "@/shared/org-permissions";
import { CONTACT_SORTS } from "@/types/schemas/contacts";

const routeApi = getRouteApi("/_app/contacts");

/** /contacts: everyone in the pipeline, each opening in a sheet. */
export function ContactsPage() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const setSearch = (update: Partial<ContactListSearch>) =>
    void navigate({
      search: (prev) => ({ ...prev, ...update }),
      replace: true,
    });
  const { stack, open } = useRecordStack();
  const openContact = (id: string) => open({ kind: "contact", id });

  const input = contactListInput(search);
  const query = useQuery(contactListQueryOptions(input));
  const selection = useListSelection(JSON.stringify(input));
  const workspace = useQuery(workspaceQueryOptions());
  const canPurge = hasOrgPermission(workspace.data?.role ?? "", {
    record: ["purge"],
  });
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  const anchorRef = useSelectionAnchor();
  const fieldColumns = useFieldColumns<ContactRow>("CONTACT");
  const columns = useMemo(
    () => [
      ...contactColumns({ archived: input.archived, anchorRef }),
      ...fieldColumns,
    ],
    [input.archived, anchorRef, fieldColumns],
  );
  const sorting: SortingState = [
    { id: input.sort, desc: input.dir === "desc" },
  ];
  const visibility = columnVisibility(
    search.hide,
    CONTACT_HIDDEN_COLUMNS,
    (hide) => setSearch({ hide }),
  );
  const table = useDataTable({
    data: query.data?.rows ?? [],
    columns,
    getRowId: (row) => row.id,
    state: {
      sorting,
      rowSelection: selection.rowSelection,
      columnVisibility: visibility.state,
    },
    onColumnVisibilityChange: visibility.onChange,
    manualSorting: true,
    enableSortingRemoval: false,
    onSortingChange: (updater) => {
      const [next] = typeof updater === "function" ? updater(sorting) : updater;
      const sort = CONTACT_SORTS.find((key) => key === next?.id);
      if (!next || !sort) return;
      setSearch({ sort, dir: next.desc ? "desc" : "asc", page: undefined });
    },
    enableRowSelection: true,
    onRowSelectionChange: selection.onRowSelectionChange,
  });

  const newContact = (
    <Button onClick={() => setCreating(true)}>
      <Plus data-icon="inline-start" />
      New contact
    </Button>
  );
  const importCsv = (
    <Button variant="outline" onClick={() => setImporting(true)}>
      <Upload data-icon="inline-start" />
      Import
    </Button>
  );

  return (
    <div className="h-full overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <PageHeader
          title="Contacts"
          description="Everyone in the pipeline."
          actions={
            <>
              {importCsv}
              {newContact}
            </>
          }
        />
        <DataTable
          table={table}
          isLoading={query.isPending}
          isFiltered={isListFiltered(search, CONTACT_FILTER_KEYS)}
          onClearFilters={() => setSearch(clearedFilters(CONTACT_FILTER_KEYS))}
          filteredTitle="No contacts match this view"
          error={
            query.isError ? (
              <QueryError
                error={query.error}
                fallback="The contacts could not be loaded."
                onRetry={() => void query.refetch()}
                isRetrying={query.isFetching}
              />
            ) : undefined
          }
          empty={
            input.archived
              ? {
                  icon: Users,
                  media: "rows",
                  title: "No archived contacts",
                }
              : {
                  icon: Users,
                  media: "rows",
                  title: "No contacts yet",
                  action: (
                    <div className="flex flex-wrap justify-center gap-2">
                      {newContact}
                      {importCsv}
                    </div>
                  ),
                }
          }
          toolbar={
            <RecordListToolbar
              entity="CONTACT"
              search={search}
              onSearchChange={setSearch}
              placeholder="Search by name, email or company…"
              filters={
                <ContactFilters search={search} onSearchChange={setSearch} />
              }
              actions={
                <>
                  <ExportButton
                    entity="CONTACT"
                    columns={CONTACT_EXPORT}
                    fetchPage={(page, pageSize) =>
                      listContacts({ data: { ...input, page, pageSize } })
                    }
                  />
                  <SavedViewsMenu
                    entity="CONTACT"
                    current={savedViewOf(search)}
                    onApply={(filters) =>
                      void navigate({
                        search: (prev) =>
                          searchFromSavedView(
                            contactListSearchSchema,
                            filters,
                            prev,
                          ),
                      })
                    }
                  />
                  <ColumnsMenu table={table} />
                  <FieldsSheetButton entity="CONTACT" />
                </>
              }
            />
          }
          footer={
            <TablePagination
              page={input.page}
              pageSize={input.pageSize}
              totalCount={query.data?.total ?? null}
              isLoading={query.isPlaceholderData}
              onPageChange={(page) =>
                setSearch({ page: page > 1 ? page : undefined })
              }
            />
          }
          onRowClick={(row) => openContact(row.original.id)}
          activeRowId={findLast(stack, (ref) => ref.kind === "contact")?.id}
        />
      </div>

      <ContactBulkActions
        ids={selection.selectedIds}
        archived={input.archived}
        canPurge={canPurge}
        onDone={selection.clear}
      />
      {importing ? (
        <ImportDialog entity="CONTACT" onClose={() => setImporting(false)} />
      ) : null}
      {creating ? (
        <CreateContactDialog
          onClose={() => setCreating(false)}
          onCreated={(contact) => {
            setCreating(false);
            openContact(contact.id);
          }}
        />
      ) : null}
    </div>
  );
}
