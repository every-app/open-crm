import type { ComponentProps, ReactNode } from "react";
import { createLink } from "@tanstack/react-router";
import { cn } from "cn";

/**
 * A part of the app with its own navigation column, as Chat and Settings
 * have. From `md` up the column sits left of the page; below it, the column
 * becomes a strip of links above the page.
 */
export function SectionLayout({
  label,
  nav,
  children,
}: {
  /** The accessible name of the section's navigation. */
  label: string;
  nav: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <nav
        aria-label={label}
        className="flex shrink-0 gap-1 overflow-x-auto border-b border-border p-2 md:w-56 md:flex-col md:gap-0.5 md:overflow-x-visible md:overflow-y-auto md:border-r md:border-b-0 md:p-3"
      >
        {nav}
      </nav>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</div>
    </div>
  );
}

/**
 * A labelled group of links in a section's navigation column, with an
 * optional action such as a new-chat button beside the label.
 */
export function SectionNavGroup({
  label,
  action,
  children,
  className,
}: {
  label: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex h-8 items-center justify-between gap-2 pr-1 pl-2.5">
        <span className="min-w-0 truncate text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
          {label}
        </span>
        {action}
      </div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

// The router sets `data-status="active"` and `aria-current="page"` on the
// link that matches the current URL.
function SectionNavAnchor({ className, ...props }: ComponentProps<"a">) {
  return (
    <a
      className={cn(
        "flex h-8 min-w-0 shrink-0 items-center gap-2.5 rounded-md px-2.5 text-sm whitespace-nowrap text-muted-foreground transition-colors outline-none hover:bg-foreground/5 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-[status=active]:bg-foreground/[0.07] data-[status=active]:font-medium data-[status=active]:text-foreground [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

/** One link in a section's navigation column. */
export const SectionNavLink = createLink(SectionNavAnchor);
