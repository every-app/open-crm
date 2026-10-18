import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import type { SortingState } from "@tanstack/react-table";
import { CircleDollarSign, Plus, Upload } from "lucide-react";
import { findLast } from "remeda";
import { PageHeader } from "@/client/components/PageHeader";
import { QueryError } from "@/client/components/QueryState";
import { ColumnsMenu } from "@/client/components/table/ColumnsMenu";
import { SortMenu } from "@/client/components/table/SortMenu";
import {
  DataTable,
  useDataTable,
  useSelectionAnchor,
} from "@/client/components/table/DataTable";
import { TablePagination } from "@/client/components/table/TablePagination";
import { Button } from "@/client/components/ui/button";
import { CreateDealDialog } from "@/client/features/deals/CreateDealDialog";
import { DealBulkActions } from "@/client/features/deals/DealBulkActions";
import { DealFilters } from "@/client/features/deals/DealFilters";
import {
  DEAL_HIDDEN_COLUMNS,
  dealColumns,
} from "@/client/features/deals/dealColumns";
import { formatAmount } from "@/client/features/deals/dealFormat";
import { dealListQueryOptions } from "@/client/features/deals/dealQueries";
import {
  DEAL_FILTER_KEYS,
  dealListInput,
  dealListSearchSchema,
  type DealListSearch,
} from "@/client/features/deals/dealSearch";
import type { DealRow } from "@/client/features/deals/dealFormat";
import { FieldsSheetButton } from "@/client/features/fields/FieldsSheetButton";
import { useFieldColumns } from "@/client/features/fields/fieldColumns";
import { ExportButton } from "@/client/features/csv/ExportButton";
import { ImportDialog } from "@/client/features/csv/ImportDialog";
import { DEAL_EXPORT } from "@/client/features/csv/exportColumns";
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
import { listDeals } from "@/serverFunctions/deals";
import { hasOrgPermission } from "@/shared/org-permissions";
import { DEAL_SORTS } from "@/types/schemas/deals";

const routeApi = getRouteApi("/_app/deals");

/** /deals: the pipeline, and every deal that has closed, each in a sheet. */
export function DealsPage() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const setSearch = (update: Partial<DealListSearch>) =>
    void navigate({
      search: (prev) => ({ ...prev, ...update }),
      replace: true,
    });
  const { stack, open } = useRecordStack();
  const openDeal = (id: string) => open({ kind: "deal", id });

  const input = dealListInput(search);
  const query = useQuery(dealListQueryOptions(input));
  const selection = useListSelection(JSON.stringify(input));
  const workspace = useQuery(workspaceQueryOptions());
  const canPurge = hasOrgPermission(workspace.data?.role ?? "", {
    record: ["purge"],
  });
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  const anchorRef = useSelectionAnchor();
  const fieldColumns = useFieldColumns<DealRow>("DEAL");
  const columns = useMemo(
    () => [
      ...dealColumns({ archived: input.archived, anchorRef }),
      ...fieldColumns,
    ],
    [input.archived, anchorRef, fieldColumns],
  );
  const sorting: SortingState = [
    { id: input.sort, desc: input.dir === "desc" },
  ];
  const visibility = columnVisibility(
    search.hide,
    DEAL_HIDDEN_COLUMNS,
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
      const sort = DEAL_SORTS.find((key) => key === next?.id);
      if (!next || !sort) return;
      setSearch({ sort, dir: next.desc ? "desc" : "asc", page: undefined });
    },
    enableRowSelection: true,
    onRowSelectionChange: selection.onRowSelectionChange,
  });

  const newDeal = (
    <Button onClick={() => setCreating(true)}>
      <Plus data-icon="inline-start" />
      New deal
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
          title="Deals"
          description="The pipeline, and everything that has already closed."
          actions={
            <>
              {importCsv}
              {newDeal}
            </>
          }
        />
        <DataTable
          table={table}
          isLoading={query.isPending}
          isFiltered={isListFiltered(search, DEAL_FILTER_KEYS)}
          onClearFilters={() => setSearch(clearedFilters(DEAL_FILTER_KEYS))}
          filteredTitle="No deals match this view"
          error={
            query.isError ? (
              <QueryError
                error={query.error}
                fallback="The deals could not be loaded."
                onRetry={() => void query.refetch()}
                isRetrying={query.isFetching}
              />
            ) : undefined
          }
          empty={
            input.archived
              ? {
                  icon: CircleDollarSign,
                  media: "rows",
                  title: "No archived deals",
                }
              : {
                  icon: CircleDollarSign,
                  media: "rows",
                  title: "No deals yet",
                  action: (
                    <div className="flex flex-wrap justify-center gap-2">
                      {newDeal}
                      {importCsv}
                    </div>
                  ),
                }
          }
          toolbar={
            <RecordListToolbar
              entity="DEAL"
              search={search}
              onSearchChange={setSearch}
              placeholder="Search deals by name or company…"
              filters={
                <DealFilters search={search} onSearchChange={setSearch} />
              }
              actions={
                <>
                  <ExportButton
                    entity="DEAL"
                    columns={DEAL_EXPORT}
                    fetchPage={(page, pageSize) =>
                      listDeals({ data: { ...input, page, pageSize } })
                    }
                  />
                  <SavedViewsMenu
                    entity="DEAL"
                    current={savedViewOf(search)}
                    onApply={(filters) =>
                      void navigate({
                        search: (prev) =>
                          searchFromSavedView(
                            dealListSearchSchema,
                            filters,
                            prev,
                          ),
                      })
                    }
                  />
                  <SortMenu table={table} />
                  <ColumnsMenu table={table} />
                  <FieldsSheetButton entity="DEAL" />
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
              meta={
                input.archived ? null : <PipelineSummary list={query.data} />
              }
            />
          }
          onRowClick={(row) => openDeal(row.original.id)}
          activeRowId={findLast(stack, (ref) => ref.kind === "deal")?.id}
        />
      </div>

      <DealBulkActions
        ids={selection.selectedIds}
        archived={input.archived}
        canPurge={canPurge}
        onDone={selection.clear}
      />
      {importing ? (
        <ImportDialog entity="DEAL" onClose={() => setImporting(false)} />
      ) : null}
      {creating ? (
        <CreateDealDialog
          onClose={() => setCreating(false)}
          onCreated={(deal) => {
            setCreating(false);
            openDeal(deal.id);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * What the open deals in view are worth in the reporting currency, and how
 * many it leaves out because no rate converts their currency.
 */
function PipelineSummary({
  list,
}: {
  list: Awaited<ReturnType<typeof listDeals>> | undefined;
}) {
  if (!list) return null;
  const { openValue, reportingCurrency, unconverted } = list;
  if (openValue === null && unconverted.count === 0) return null;
  return (
    <span>
      <span className="text-foreground">
        {formatAmount(openValue ?? 0, reportingCurrency)}
      </span>{" "}
      open pipeline
      {unconverted.count > 0
        ? ` · ${unconverted.count} not counted (no ${unconverted.currencies.join(", ")} rate)`
        : null}
    </span>
  );
}
