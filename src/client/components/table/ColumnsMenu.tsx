import type { Column, Table } from "@tanstack/react-table";
import { ChevronDown, Columns3, Settings2 } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";

/** What a menu calls a column: its `meta.label`, or its header's text. */
export function columnLabel<TData>(column: Column<TData>): string {
  const { header, meta } = column.columnDef;
  return meta?.label ?? (typeof header === "string" ? header : column.id);
}

/**
 * A list toolbar's "Columns" menu: shows or hides each column that can be,
 * then "Edit fields…", which opens the list's fields sheet.
 */
export function ColumnsMenu<TData>({
  table,
  onEditFields,
}: {
  table: Table<TData>;
  onEditFields: () => void;
}) {
  const columns = table
    .getAllLeafColumns()
    .filter((column) => column.getCanHide());
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        <Columns3 data-icon="inline-start" />
        <span className="max-sm:sr-only">Columns</span>
        <ChevronDown data-icon="inline-end" className="text-muted-foreground" />
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
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onEditFields}>
          <Settings2 />
          Edit fields…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
