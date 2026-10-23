import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import type { Column, Table } from "@tanstack/react-table";
import { ChevronDown, Columns3, Settings2 } from "lucide-react";
import { RowCheckbox } from "@/client/components/table/RowCheckbox";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";

/** What a menu calls a column: its `meta.label`, or its header's text. */
export function columnLabel<TData>(column: Column<TData>): string {
  const { header, meta } = column.columnDef;
  return meta?.label ?? (typeof header === "string" ? header : column.id);
}

/**
 * A table toolbar's "Columns" menu: shows or hides each column that can be,
 * then, on a record list, "Edit fields…", which opens its fields sheet.
 */
export function ColumnsMenu<TData>({
  table,
  onEditFields,
  showLabel = false,
}: {
  table: Table<TData>;
  onEditFields?: () => void;
  showLabel?: boolean;
}) {
  const columns = table
    .getAllLeafColumns()
    .filter((column) => column.getCanHide());
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        <Columns3 data-icon="inline-start" />
        <span className={showLabel ? undefined : "max-sm:sr-only"}>
          Columns
        </span>
        <ChevronDown data-icon="inline-end" className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {columns.map((column) => (
          <MenuPrimitive.CheckboxItem
            key={column.id}
            checked={column.getIsVisible()}
            onCheckedChange={(checked) => column.toggleVisibility(checked)}
            className="group/check flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground"
          >
            <RowCheckbox />
            {columnLabel(column)}
          </MenuPrimitive.CheckboxItem>
        ))}
        {onEditFields ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onEditFields}>
              <Settings2 />
              Edit fields…
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
