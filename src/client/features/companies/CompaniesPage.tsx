import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, getRouteApi } from "@tanstack/react-router";
import type { SortingState } from "@tanstack/react-table";
import { Building2, Plus, Upload } from "lucide-react";
import { difference, findLast } from "remeda";
import { toast } from "sonner";
import { cn } from "cn";
import { PageHeader } from "@/client/components/PageHeader";
import { QueryError } from "@/client/components/QueryState";
import {
  DataTable,
  useDataTable,
  useSelectionAnchor,
} from "@/client/components/table/DataTable";
import {
  PageLink,
  TablePagination,
} from "@/client/components/table/TablePagination";
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
import { AddMatchingToList } from "@/client/features/lists/ListActions";
import { ListBoard } from "@/client/features/lists/ListBoard";
import {
  ListBar,
  ListDescription,
  ListTitle,
} from "@/client/features/lists/ListView";
import { listsColumn, stageColumn } from "@/client/features/lists/listColumns";
import { listsQueryOptions } from "@/client/features/lists/listQueries";
import { CsvMenu } from "@/client/features/csv/CsvMenu";
import { ImportDialog } from "@/client/features/csv/ImportDialog";
import { COMPANY_EXPORT } from "@/client/features/csv/exportColumns";
import { RecordListToolbar } from "@/client/features/records/RecordListToolbar";
import {
  LIST_MEMBERSHIP_FILTER_KEYS,
  clearedFilters,
  columnVisibility,
  isListFiltered,
  searchFromSavedView,
  useListSelection,
} from "@/client/features/records/listSearch";
import {
  useInvalidateRecords,
  usePrefetchRecord,
} from "@/client/features/records/recordQueries";
import {
  useNewForm,
  useRecordStack,
  recordKey,
} from "@/client/features/records/recordStack";
import { workspaceQueryOptions } from "@/client/features/workspace/workspaceQueries";
import { listCompanies } from "@/serverFunctions/companies";
import { addToList } from "@/serverFunctions/lists";
import { hasOrgPermission } from "@/shared/org-permissions";
import { COMPANY_SORTS } from "@/types/schemas/companies";

const routeApi = getRouteApi("/_app/companies");

/** The toolbar's search and filters: not an open list's stage tab or Due. */
const TOOLBAR_FILTER_KEYS = difference(
  COMPANY_FILTER_KEYS,
  LIST_MEMBERSHIP_FILTER_KEYS,
);

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
  const prefetchRecord = usePrefetchRecord();
  const invalidate = useInvalidateRecords();
  const query = useQuery(companyListQueryOptions(input));
  const filters = companyFilters(search, setSearch, query.data?.facetCounts);
  const selection = useListSelection(JSON.stringify(input));
  const workspace = useQuery(workspaceQueryOptions());
  const canPurge = hasOrgPermission(workspace.data?.role ?? "", {
    record: ["purge"],
  });
  const [creating, setCreating] = useNewForm();
  const [importing, setImporting] = useState(false);

  // A list from the sidebar (`?list=`) shows in this page, its stages and board with it.
  const lists = useQuery(listsQueryOptions());
  const openList = search.list
    ? lists.data?.find(
        (list) => list.id === search.list && list.entity === "COMPANY",
      )
    : undefined;
  const board = Boolean(
    openList && openList.stages.length > 0 && search.view === "board",
  );

  const anchorRef = useSelectionAnchor();
  const fieldColumns = useFieldColumns<CompanyRow>("COMPANY");
  const columns = useMemo(() => {
    const [select, name, ...rest] = companyColumns({
      archived: input.archived,
      anchorRef,
    });
    return [
      ...(select && name ? [select, name] : []),
      ...(openList && openList.stages.length > 0
        ? [stageColumn<CompanyRow>(openList)]
        : []),
      ...rest,
      // An open list is the list every row is in: no Lists column.
      ...(openList ? [] : [listsColumn<CompanyRow>()]),
      ...fieldColumns,
    ];
  }, [input.archived, anchorRef, fieldColumns, openList]);
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
    <div className="flex h-full flex-col overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      {/* The rows scroll inside the table's card, under its header. */}
      {/* A board takes the full width, its columns scrolling sideways past it. */}
      <div
        className={cn(
          "mx-auto flex min-h-0 w-full min-w-0 flex-1 flex-col gap-4",
          !board && "max-w-7xl",
        )}
      >
        <PageHeader
          title={
            openList ? (
              <ListTitle list={openList} />
            ) : input.archived ? (
              "Archived companies"
            ) : (
              "Companies"
            )
          }
          description={
            openList ? (
              <ListDescription list={openList} />
            ) : input.archived ? undefined : (
              "Companies, with their people and the mail and meetings filed on them."
            )
          }
          actions={
            <>
              {input.archived ? null : (
                <AddMatchingToList
                  entity="COMPANY"
                  filters={input}
                  filtered={isListFiltered(search, TOOLBAR_FILTER_KEYS)}
                  total={query.data?.total}
                  openListId={openList?.id}
                />
              )}
              <CsvMenu
                entity="COMPANY"
                columns={COMPANY_EXPORT}
                fetchPage={(page, pageSize) =>
                  listCompanies({ data: { ...input, page, pageSize } })
                }
                onImport={() => setImporting(true)}
                list={openList}
                canDeleteList={canPurge}
              />
              {newCompany}
            </>
          }
        />
        {openList ? (
          <ListBar
            list={openList}
            stage={input.listStage}
            due={input.due}
            view={board ? "board" : "table"}
            onChange={(update) =>
              setSearch({
                // The board has no toolbar: no search or filter stays set
                // where it can't be seen.
                ...(update.view
                  ? {
                      ...clearedFilters(TOOLBAR_FILTER_KEYS),
                      archived: undefined,
                    }
                  : {}),
                ...update,
                page: undefined,
              })
            }
          />
        ) : null}
        {openList && board ? (
          <ListBoard list={openList} due={input.due} onOpen={openCompany} />
        ) : (
          <DataTable
            table={table}
            isLoading={query.isPending}
            isFiltered={isListFiltered(search, COMPANY_FILTER_KEYS)}
            onClearFilters={() =>
              setSearch(clearedFilters(COMPANY_FILTER_KEYS))
            }
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
                    media: "icon",
                    title: "No archived companies",
                  }
                : openList
                  ? {
                      icon: Building2,
                      media: "icon",
                      title: "This list is empty",
                      action: (
                        <Button
                          nativeButton={false}
                          render={<Link to="/companies" />}
                        >
                          Add from Companies
                        </Button>
                      ),
                    }
                  : {
                      icon: Building2,
                      media: "icon",
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
                      openList={openList}
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
                // Prev and next are links, each page a step the browser's
                // Back returns to; a page put back in range replaces its own.
                renderPageButton={PageLink}
                onPageChange={(page) =>
                  setSearch({ page: page > 1 ? page : undefined })
                }
              />
            }
            onRowClick={(row) => openCompany(row.original.id)}
            onRowHover={(row) =>
              prefetchRecord({ kind: "company", id: row.original.id })
            }
            scrollClassName="min-h-0 flex-1"
            activeRowId={findLast(stack, (ref) => ref.kind === "company")?.id}
          />
        )}
      </div>

      {importing ? (
        <ImportDialog entity="COMPANY" onClose={() => setImporting(false)} />
      ) : null}
      {creating ? (
        <CreateCompanyDialog
          onClose={() => setCreating(false)}
          // Continue with a deal for this company, in the form's history entry.
          onCreated={(company) => {
            // Made from a list, it goes in it.
            if (openList)
              void addToList({
                data: { listId: openList.id, ids: [company.id] },
              })
                .then(() => invalidate())
                .catch(() =>
                  toast.error(`Couldn't add it to ${openList.name}.`),
                );
            void navigate({
              search: (prev) => ({
                ...prev,
                record: recordKey({ kind: "company", id: company.id }),
                new: undefined,
                add: "deal",
              }),
              replace: true,
            });
          }}
        />
      ) : null}
    </div>
  );
}
