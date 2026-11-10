import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";

type PageButtonProps = {
  page: number;
  disabled: boolean;
  label: string;
  children: ReactNode;
  onPageChange: (nextPage: number) => void;
};

type Props = {
  page: number;
  pageSize: number;
  /** Null while the first page loads. */
  totalCount: number | null;
  isLoading?: boolean;
  onPageChange: (nextPage: number) => void;
  /** Render prev/next as links, for pages whose number lives in the URL. */
  renderPageButton?: (props: PageButtonProps) => ReactNode;
  /** Beside the row count: a figure about the rows, such as their total. */
  meta?: ReactNode;
};

export function TablePagination({
  page,
  pageSize,
  totalCount,
  isLoading = false,
  onPageChange,
  renderPageButton = PageButton,
  meta,
}: Props) {
  const totalPages =
    totalCount != null ? Math.max(1, Math.ceil(totalCount / pageSize)) : null;
  const isOutOfRange = totalPages != null && page > totalPages;
  const currentPage = isOutOfRange ? totalPages : page;
  const canGoPrev = currentPage > 1;
  const canGoNext = totalPages != null && currentPage < totalPages;
  // A single page has nowhere to go: the range alone says where you are.
  const hasPages = canGoPrev || canGoNext;

  // A page can fall past the end when rows are removed or a stale URL is
  // opened. Move to the last page instead of showing an empty table.
  useEffect(() => {
    if (isOutOfRange && !isLoading) onPageChange(currentPage);
  }, [currentPage, isLoading, isOutOfRange, onPageChange]);

  // An empty table has no pages to show.
  if (totalCount === 0) return null;

  return (
    <div className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2 text-sm text-muted-foreground tabular-nums">
        <span className="whitespace-nowrap">
          {formatRange(currentPage, pageSize, totalCount)}
        </span>
        {meta ? (
          <>
            <span aria-hidden>·</span>
            {meta}
          </>
        ) : null}
        {isLoading ? <Spinner className="size-3.5" /> : null}
      </div>

      {hasPages ? (
        <div className="flex items-center gap-1">
          {renderPageButton({
            page: currentPage - 1,
            disabled: !canGoPrev || isLoading,
            label: "Previous page",
            children: <ChevronLeft />,
            onPageChange,
          })}
          {renderPageButton({
            page: currentPage + 1,
            disabled: !canGoNext || isLoading,
            label: "Next page",
            children: <ChevronRight />,
            onPageChange,
          })}
        </div>
      ) : null}
    </div>
  );
}

function PageButton({
  page,
  disabled,
  label,
  children,
  onPageChange,
}: PageButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      disabled={disabled}
      onClick={() => onPageChange(page)}
    >
      {children}
    </Button>
  );
}

/**
 * Prev and next as links to their page in the URL's `page` (none for the
 * first), for lists whose page lives there: each page is then a step the
 * browser's Back returns to.
 */
export function PageLink(props: PageButtonProps) {
  const { page, disabled, label, children } = props;
  if (disabled) return <PageButton {...props} />;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      nativeButton={false}
      render={
        <Link
          to="."
          search={(prev) => ({ ...prev, page: page > 1 ? page : undefined })}
        />
      }
    >
      {children}
    </Button>
  );
}

function formatRange(
  page: number,
  pageSize: number,
  totalCount: number | null,
) {
  const start = (page - 1) * pageSize + 1;
  const pageEnd = start + pageSize - 1;
  if (totalCount == null) {
    return `${start.toLocaleString()}–${pageEnd.toLocaleString()}`;
  }
  const end = Math.min(totalCount, pageEnd);
  return `${start.toLocaleString()}–${end.toLocaleString()} of ${totalCount.toLocaleString()}`;
}
