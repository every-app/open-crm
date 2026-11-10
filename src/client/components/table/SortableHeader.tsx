import { ArrowDown, ArrowUp } from "lucide-react";

type SortableColumn = {
  getIsSorted: () => false | "asc" | "desc";
  getToggleSortingHandler: () => ((event: unknown) => void) | undefined;
};

/**
 * A column header's `aria-sort`, for its header cell (where the CRM's tables
 * set it): the direction a sortable column is sorted in, else "none";
 * nothing on a column that doesn't sort.
 */
export function ariaSort(column: {
  getCanSort: () => boolean;
  getIsSorted: () => false | "asc" | "desc";
}): "ascending" | "descending" | "none" | undefined {
  if (!column.getCanSort()) return undefined;
  const sorted = column.getIsSorted();
  if (sorted === "asc") return "ascending";
  return sorted === "desc" ? "descending" : "none";
}

export function SortableHeader({
  column,
  label,
  align,
}: {
  column: SortableColumn;
  label: string;
  align?: "left" | "right";
}) {
  const sorted = column.getIsSorted();
  const content = (
    <button
      type="button"
      className="inline-flex max-w-full items-center gap-1 font-medium transition-colors hover:text-foreground"
      onClick={column.getToggleSortingHandler()}
      aria-label={`Sort by ${label}`}
    >
      <span className="truncate">{label}</span>
      {sorted === "asc" ? (
        <ArrowUp className="size-3 shrink-0" />
      ) : sorted === "desc" ? (
        <ArrowDown className="size-3 shrink-0" />
      ) : null}
    </button>
  );

  if (align === "right") {
    return <span className="flex w-full justify-end">{content}</span>;
  }

  return content;
}
