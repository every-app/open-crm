import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import type { RecordRef } from "@/shared/records";

/** Each kind of record's list, where its sheet opens. */
const LIST_ROUTES = {
  company: "/companies",
  contact: "/contacts",
  deal: "/deals",
} as const;

/**
 * Opens a related record: its sheet over its own list, so the back button
 * returns to the record this link was on.
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
  return (
    <Link
      to={LIST_ROUTES[record.kind]}
      search={{ record: record.id }}
      className={cn(
        "min-w-0 truncate underline-offset-4 hover:underline",
        className,
      )}
    >
      {children}
    </Link>
  );
}
