import type { Column, Table } from "@tanstack/react-table";
import { Columns3 } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";

/** What a menu calls a column: its `meta.label`, or its header's text. */
export function columnLabel<TData>(column: Column<TData>): string {
  const { header, meta } = column.columnDef;
  return meta?.label ?? (typeof header === "string" ? header : column.id);
}

/** A list toolbar's "Columns" menu: shows or hides each column that can be. */
export function ColumnsMenu<TData>({ table }: { table: Table<TData> }) {
  const columns = table
    .getAllLeafColumns()
    .filter((column) => column.getCanHide());
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        <Columns3 data-icon="inline-start" />
        Columns
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
          {columns.map((column) => (
            <DropdownMenuCheckboxItem
              key={column.id}
              checked={column.getIsVisible()}
              onCheckedChange={(checked) => column.toggleVisibility(checked)}
            >
              {columnLabel(column)}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
