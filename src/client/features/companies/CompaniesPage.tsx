import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import type { SortingState } from "@tanstack/react-table";
import { Plus, Upload } from "lucide-react";
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
import { CompanySheet } from "@/client/features/companies/CompanySheet";
import { CreateCompanyDialog } from "@/client/features/companies/CreateCompanyDialog";
import { companyColumns } from "@/client/features/companies/companyColumns";
import { companyListQueryOptions } from "@/client/features/companies/companyQueries";
import {
  companyListInput,
  companyListSearchSchema,
  type CompanyListSearch,
} from "@/client/features/companies/companySearch";
import type { CompanyRow } from "@/client/features/companies/companyFormat";
import { FieldsSheetButton } from "@/client/features/fields/FieldsSheetButton";
import { useFieldColumns } from "@/client/features/fields/fieldColumns";
import { ExportButton } from "@/client/features/csv/ExportButton";
import { ImportDialog } from "@/client/features/csv/ImportDialog";
import { COMPANY_EXPORT } from "@/client/features/csv/exportColumns";
import { RecordListToolbar } from "@/client/features/records/RecordListToolbar";
import {
  isListFiltered,
  savedViewOf,
  searchFromSavedView,
  useListSelection,
} from "@/client/features/records/listSearch";
import { SavedViewsMenu } from "@/client/features/saved-views/SavedViewsMenu";
import { workspaceQueryOptions } from "@/client/features/workspace/workspaceQueries";
import { listCompanies } from "@/serverFunctions/companies";
import { hasOrgPermission } from "@/shared/org-permissions";
import { COMPANY_SORTS } from "@/types/schemas/companies";

const routeApi = getRouteApi("/_app/companies");

/** /companies: every account in the pipeline, each opening in a sheet. */
export function CompaniesPage() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const setSearch = (update: Partial<CompanyListSearch>, push = false) =>
    void navigate({
      search: (prev) => ({ ...prev, ...update }),
      replace: !push,
    });
  const openCompany = (id: string) =>
    setSearch({ record: id, tab: undefined }, true);

  const input = companyListInput(search);
  const query = useQuery(companyListQueryOptions(input));
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
  const table = useDataTable({
    data: query.data?.rows ?? [],
    columns,
    getRowId: (row) => row.id,
    state: { sorting, rowSelection: selection.rowSelection },
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
      Import
    </Button>
  );

  return (
    <div className="h-full overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <PageHeader
          title="Companies"
          description="Every account in the pipeline."
          actions={
            <>
              {importCsv}
              {newCompany}
            </>
          }
        />
        <DataTable
          table={table}
          isLoading={query.isPending}
          isFiltered={isListFiltered(search)}
          onClearFilters={() =>
            setSearch({
              q: undefined,
              owner: undefined,
              fields: undefined,
              page: undefined,
            })
          }
          error={
            query.isError ? (
              <QueryError
                error={query.error}
                fallback="The companies could not be loaded."
                onRetry={() => void query.refetch()}
                isRetrying={query.isFetching}
              />
            ) : undefined
          }
          empty={
            input.archived
              ? {
                  title: "No archived companies",
                  description:
                    "A company you archive waits here until it's restored or deleted forever.",
                }
              : {
                  title: "No companies yet",
                  description:
                    "Add the first account you sell to, or import them from a CSV. The agent fills in the rest.",
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
              search={search}
              onSearchChange={setSearch}
              placeholder="Search by name or domain"
              actions={
                <>
                  <ExportButton
                    entity="COMPANY"
                    columns={COMPANY_EXPORT}
                    fetchPage={(page, pageSize) =>
                      listCompanies({ data: { ...input, page, pageSize } })
                    }
                  />
                  <SavedViewsMenu
                    entity="COMPANY"
                    current={savedViewOf(search)}
                    onApply={(filters) =>
                      void navigate({
                        search: (prev) =>
                          searchFromSavedView(
                            companyListSearchSchema,
                            filters,
                            prev,
                          ),
                      })
                    }
                  />
                  <FieldsSheetButton entity="COMPANY" />
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
          onRowClick={(row) => openCompany(row.original.id)}
          activeRowId={search.record}
        />
      </div>

      <CompanyBulkActions
        ids={selection.selectedIds}
        archived={input.archived}
        canPurge={canPurge}
        onDone={selection.clear}
      />
      <CompanySheet
        companyId={search.record}
        tab={search.tab ?? "overview"}
        onTabChange={(tab) =>
          setSearch({ tab: tab === "overview" ? undefined : tab })
        }
        onClose={() => setSearch({ record: undefined, tab: undefined })}
      />
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
