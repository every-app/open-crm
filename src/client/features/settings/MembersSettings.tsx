import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { flexRender, type SortingState } from "@tanstack/react-table";
import { ExternalLink } from "lucide-react";
import { EmptyState } from "@/client/components/EmptyState";
import { QueryError } from "@/client/components/QueryState";
import {
  SettingsCard,
  SettingsPage,
} from "@/client/components/SettingsSection";
import { everyAppAccountQueryOptions } from "@/client/components/Sidebar";
import { useDataTable } from "@/client/components/table/DataTable";
import { ariaSort } from "@/client/components/table/SortableHeader";
import { DataTableToolbar } from "@/client/components/table/DataTableToolbar";
import { TablePagination } from "@/client/components/table/TablePagination";
import { Button } from "@/client/components/ui/button";
import { Skeleton } from "@/client/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import {
  MemberSearch,
  RoleFilter,
} from "@/client/features/members/MemberFilters";
import { memberColumns } from "@/client/features/members/memberColumns";
import { membersQueryOptions } from "@/client/features/members/memberQueries";
import {
  isRole,
  roleCounts,
  rolesOf,
} from "@/client/features/members/memberRoles";
import { MEMBER_SORTS, type MembersSearch } from "@/types/schemas/members";

const routeApi = getRouteApi("/_app/settings/members");

const PAGE_SIZE = 25;

/**
 * Settings → Members (the CRM's members table): everyone who has opened the
 * CRM, to search, filter by role and sort. The Every App gateway owns the
 * real list: invitations and roles are changed there.
 */
export function MembersSettings() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const setSearch = (update: Partial<MembersSearch>) =>
    void navigate({
      search: (prev) => ({ ...prev, ...update }),
      replace: true,
    });
  const members = useQuery(membersQueryOptions());
  const { data: account } = useQuery(everyAppAccountQueryOptions());

  const needle = search.q?.trim().toLowerCase() ?? "";
  const roles = useMemo(() => search.role ?? [], [search.role]);
  // The table's rows keep their identity between renders, as a query's do.
  const searched = useMemo(
    () =>
      (members.data ?? []).filter(
        (member) =>
          !needle ||
          member.name.toLowerCase().includes(needle) ||
          member.email.toLowerCase().includes(needle),
      ),
    [members.data, needle],
  );
  const rows = useMemo(
    () =>
      roles.length === 0
        ? searched
        : searched.filter((member) =>
            rolesOf(member).some(
              (name) => isRole(name) && roles.includes(name),
            ),
          ),
    [searched, roles],
  );
  const page = search.page ?? 1;
  const sorting: SortingState = [
    { id: search.sort ?? "joinedAt", desc: search.dir === "desc" },
  ];
  const viewerId = account?.userId ?? null;
  const columns = useMemo(() => memberColumns(viewerId), [viewerId]);
  const table = useDataTable({
    data: rows,
    columns,
    getRowId: (member) => member.userId,
    state: {
      sorting,
      pagination: { pageIndex: page - 1, pageSize: PAGE_SIZE },
    },
    withSorting: true,
    withPagination: true,
    // The page lives in the URL; TablePagination moves it back in range.
    autoResetPageIndex: false,
    enableSortingRemoval: false,
    onSortingChange: (updater) => {
      const [next] = typeof updater === "function" ? updater(sorting) : updater;
      const sort = MEMBER_SORTS.find((key) => key === next?.id);
      if (!next || !sort) return;
      setSearch({ sort, dir: next.desc ? "desc" : "asc", page: undefined });
    },
  });
  const filtered = needle !== "" || roles.length > 0;

  return (
    <SettingsPage
      title="Members"
      actions={
        account?.gatewayUrl ? (
          <Button
            variant="outline"
            nativeButton={false}
            render={
              <a href={account.gatewayUrl} target="_blank" rel="noreferrer" />
            }
          >
            Manage on Every App
            <ExternalLink data-icon="inline-end" aria-hidden />
          </Button>
        ) : null
      }
    >
      {members.isError ? (
        <QueryError
          error={members.error}
          fallback="The members could not be loaded."
          onRetry={() => void members.refetch()}
          isRetrying={members.isFetching}
        />
      ) : null}
      <SettingsCard className="divide-y-0">
        <DataTableToolbar>
          <MemberSearch
            value={search.q ?? ""}
            onCommit={(q) => setSearch({ q: q || undefined, page: undefined })}
          />
          <RoleFilter
            value={roles}
            counts={roleCounts(searched)}
            onChange={(role) =>
              setSearch({
                role: role.length > 0 ? role : undefined,
                page: undefined,
              })
            }
          />
        </DataTableToolbar>
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    aria-sort={ariaSort(header.column)}
                    className={header.column.columnDef.meta?.headerClassName}
                  >
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {members.isPending ? (
              <TableRow aria-hidden>
                {table.getVisibleLeafColumns().map((column) => (
                  <TableCell
                    key={column.id}
                    className={
                      typeof column.columnDef.meta?.cellClassName === "string"
                        ? column.columnDef.meta.cellClassName
                        : undefined
                    }
                  >
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length}>
                  <EmptyState
                    kind="filtered"
                    variant="plain"
                    title="Nobody matches this view."
                    action={
                      filtered ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setSearch({
                              q: undefined,
                              role: undefined,
                              page: undefined,
                            })
                          }
                        >
                          Clear filters
                        </Button>
                      ) : undefined
                    }
                  />
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta?.cellClassName;
                    return (
                      <TableCell
                        key={cell.id}
                        className={
                          typeof meta === "function" ? meta(row) : meta
                        }
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <TablePagination
          page={page}
          pageSize={PAGE_SIZE}
          totalCount={members.data ? rows.length : null}
          isLoading={members.isPending}
          onPageChange={(next) =>
            setSearch({ page: next > 1 ? next : undefined })
          }
        />
      </SettingsCard>
    </SettingsPage>
  );
}
