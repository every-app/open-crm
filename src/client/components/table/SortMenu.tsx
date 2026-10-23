import type { Table } from "@tanstack/react-table";
import { ArrowUpDown, ChevronDown } from "lucide-react";
import { columnLabel } from "@/client/components/table/ColumnsMenu";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";

/**
 * A list toolbar's "Sort" menu, beside the sortable headers as in the
 * original CRM: every column the list sorts by, shown or hidden, then which
 * way. A new column keeps the direction. The table's `onSortingChange`
 * writes the choice to the URL, as a header click does.
 */
export function SortMenu<TData>({
  table,
  showLabel = false,
}: {
  table: Table<TData>;
  showLabel?: boolean;
}) {
  const [current] = table.getState().sorting;
  if (!current) return null;
  const columns = table
    .getAllLeafColumns()
    .filter((column) => column.getCanSort());
  const sortBy = (id: string, desc: boolean) =>
    table.setSorting([{ id, desc }]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        <ArrowUpDown data-icon="inline-start" />
        <span className={showLabel ? undefined : "max-sm:sr-only"}>Sort</span>
        <ChevronDown data-icon="inline-end" className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuRadioGroup
          value={current.id}
          onValueChange={(id: string) => sortBy(id, current.desc)}
        >
          {columns.map((column) => (
            <DropdownMenuRadioItem key={column.id} value={column.id}>
              {columnLabel(column)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={current.desc ? "desc" : "asc"}
          onValueChange={(dir: string) => sortBy(current.id, dir === "desc")}
        >
          <DropdownMenuRadioItem value="asc">Ascending</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="desc">Descending</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
