import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { useRecordStack } from "@/client/features/records/recordStack";
import type { RecordRef } from "@/shared/records";

/**
 * Opens a record's sheet over the current page, on top of any sheet already
 * open: that one's Back comes back to it. A link, so it also opens in a new
 * tab. Inside a clickable row, it opens only its own record.
 */
export function RecordLink({
  record,
  className,
  children,
}: {
  record: RecordRef;
  className?: string;
  children: ReactNode;
}) {
  const { stack, openSearch } = useRecordStack();
  return (
    <Link
      to="."
      search={openSearch(record)}
      replace={stack.length > 0}
      onClick={(event) => event.stopPropagation()}
      className={cn(
        "min-w-0 truncate underline-offset-4 hover:underline",
        className,
      )}
    >
      {children}
    </Link>
  );
}
