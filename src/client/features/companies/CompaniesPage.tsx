import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import type { SortingState } from "@tanstack/react-table";
import { Building2, Plus, Upload } from "lucide-react";
import { findLast } from "remeda";
import { PageHeader } from "@/client/components/PageHeader";
import { QueryError } from "@/client/components/QueryState";
import {
  DataTable,
  useDataTable,
  useSelectionAnchor,
} from "@/client/components/table/DataTable";
import { TablePagination } from "@/client/components/table/TablePagination";
import { Button } from "@/client/components/ui/button";
import { CompanyBulkActions } from "@/client/features/companies/CompanyBulkActions";
import { companyFilters } from "@/client/features/companies/CompanyFilters";
import { CreateCompanyDialog } from "@/client/features/companies/CreateCompanyDialog";
import {
  COMPANY_HIDDEN_COLUMNS,
  companyColumns,
} from "@/client/features/companies/companyColumns";
import { companyListQueryOptions } from "@/client/features/companies/companyQueries";
import {
  COMPANY_FILTER_KEYS,
  companyListInput,
  companyListSearchSchema,
  type CompanyListSearch,
} from "@/client/features/companies/companySearch";
import type { CompanyRow } from "@/client/features/companies/companyFormat";
import { useFieldColumns } from "@/client/features/fields/fieldColumns";
import { CsvMenu } from "@/client/features/csv/CsvMenu";
import { ImportDialog } from "@/client/features/csv/ImportDialog";
import { COMPANY_EXPORT } from "@/client/features/csv/exportColumns";
import { RecordListToolbar } from "@/client/features/records/RecordListToolbar";
import {
  clearedFilters,
  columnVisibility,
  isListFiltered,
  searchFromSavedView,
  useListSelection,
} from "@/client/features/records/listSearch";
import { useRecordStack } from "@/client/features/records/recordStack";
import { workspaceQueryOptions } from "@/client/features/workspace/workspaceQueries";
import { listCompanies } from "@/serverFunctions/companies";
import { hasOrgPermission } from "@/shared/org-permissions";
import { COMPANY_SORTS } from "@/types/schemas/companies";

const routeApi = getRouteApi("/_app/companies");

/** /companies: every account in the pipeline, each opening in a sheet. */
export function CompaniesPage() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const setSearch = (update: Partial<CompanyListSearch>) =>
    void navigate({
      search: (prev) => ({ ...prev, ...update }),
      replace: true,
    });
  const { stack, open } = useRecordStack();
  const openCompany = (id: string) => open({ kind: "company", id });

  const input = companyListInput(search);
  const query = useQuery(companyListQueryOptions(input));
  const filters = companyFilters(search, setSearch, query.data?.facetCounts);
  const selection = useListSelection(JSON.stringify(input));
  const workspace = useQuery(workspaceQueryOptions());
  const canPurge = hasOrgPermission(workspace.data?.role ?? "", {
    record: ["purge"],
  });
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  const anchorRef = useSelectionAnchor();
  const fieldColumns = useFieldColumns<CompanyRow>("COMPANY");
  const columns = useMemo(
    () => [
      ...companyColumns({ archived: input.archived, anchorRef }),
      ...fieldColumns,
    ],
    [input.archived, anchorRef, fieldColumns],
  );
  const sorting: SortingState = [
    { id: input.sort, desc: input.dir === "desc" },
  ];
  const visibility = columnVisibility(
    search.hide,
    COMPANY_HIDDEN_COLUMNS,
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
      const sort = COMPANY_SORTS.find((key) => key === next?.id);
      if (!next || !sort) return;
      setSearch({ sort, dir: next.desc ? "desc" : "asc", page: undefined });
    },
    enableRowSelection: true,
    onRowSelectionChange: selection.onRowSelectionChange,
  });

  const newCompany = (
    <Button onClick={() => setCreating(true)}>
      <Plus data-icon="inline-start" />
      New company
    </Button>
  );
  const importCsv = (
    <Button variant="outline" onClick={() => setImporting(true)}>
      <Upload data-icon="inline-start" />
      Import CSV
    </Button>
  );

  return (
    <div className="h-full overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <PageHeader
          title="Companies"
          actions={
            <>
              <CsvMenu
                entity="COMPANY"
                columns={COMPANY_EXPORT}
                fetchPage={(page, pageSize) =>
                  listCompanies({ data: { ...input, page, pageSize } })
                }
                onImport={() => setImporting(true)}
              />
              {newCompany}
            </>
          }
        />
        <DataTable
          table={table}
          isLoading={query.isPending}
          isFiltered={isListFiltered(search, COMPANY_FILTER_KEYS)}
          onClearFilters={() => setSearch(clearedFilters(COMPANY_FILTER_KEYS))}
          filteredTitle="No matches"
          error={
            query.isError ? (
              <QueryError
                error={query.error}
                fallback="Couldn't load companies."
                onRetry={() => void query.refetch()}
                isRetrying={query.isFetching}
              />
            ) : undefined
          }
          empty={
            input.archived
              ? {
                  icon: Building2,
                  media: "rows",
                  title: "No archived companies",
                }
              : {
                  icon: Building2,
                  media: "rows",
                  title: "No companies",
                  action: (
                    <div className="flex flex-wrap justify-center gap-2">
                      {newCompany}
                      {importCsv}
                    </div>
                  ),
                }
          }
          toolbar={
            <RecordListToolbar
              entity="COMPANY"
              table={table}
              search={search}
              onSearchChange={setSearch}
              onApplyView={(view) =>
                void navigate({
                  search: (prev) =>
                    searchFromSavedView(companyListSearchSchema, view, prev),
                })
              }
              placeholder="Search companies…"
              facetCounts={query.data?.facetCounts}
              filters={filters}
              filterKeys={COMPANY_FILTER_KEYS}
              selection={{
                count: selection.selectedIds.length,
                onClear: selection.clear,
                actions: (
                  <CompanyBulkActions
                    ids={selection.selectedIds}
                    archived={input.archived}
                    canPurge={canPurge}
                    onDone={selection.clear}
                  />
                ),
              }}
            />
          }
          footer={
            <TablePagination
              page={input.page}
              pageSize={input.pageSize}
              totalCount={query.data?.total ?? null}
              isLoading={query.isPlaceholderData}
              // Each page is a step the browser's Back returns to; the
              // search, filters and sort replace theirs.
              onPageChange={(page) =>
                void navigate({
                  search: (prev) => ({
                    ...prev,
                    page: page > 1 ? page : undefined,
                  }),
                })
              }
            />
          }
          onRowClick={(row) => openCompany(row.original.id)}
          activeRowId={findLast(stack, (ref) => ref.kind === "company")?.id}
        />
      </div>

      {importing ? (
        <ImportDialog entity="COMPANY" onClose={() => setImporting(false)} />
      ) : null}
      {creating ? (
        <CreateCompanyDialog
          onClose={() => setCreating(false)}
          onCreated={(company) => {
            setCreating(false);
            openCompany(company.id);
          }}
        />
      ) : null}
    </div>
  );
}
