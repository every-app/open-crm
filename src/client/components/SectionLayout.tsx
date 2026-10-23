import type { ComponentProps, ReactNode } from "react";
import { createLink } from "@tanstack/react-router";
import { cn } from "cn";

/**
 * A settings area with a navigation column on desktop and a section picker
 * on mobile.
 */
export function SectionLayout({
  label,
  nav,
  mobileNav,
  children,
}: {
  /** The accessible name of the section's navigation. */
  label: string;
  nav: ReactNode;
  mobileNav?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      {mobileNav ? (
        <div className="border-b border-border p-3 md:hidden">{mobileNav}</div>
      ) : null}
      <nav
        aria-label={label}
        className={cn(
          "shrink-0 gap-1 border-b border-border p-2 md:flex md:w-56 md:flex-col md:gap-0.5 md:overflow-y-auto md:border-r md:border-b-0 md:p-3",
          mobileNav ? "hidden" : "flex overflow-x-auto",
        )}
      >
        {nav}
      </nav>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</div>
    </div>
  );
}

// The router sets `data-status="active"` and `aria-current="page"` on the
// link that matches the current URL.
function SectionNavAnchor({ className, ...props }: ComponentProps<"a">) {
  return (
    <a
      className={cn(
        "flex h-8 min-w-0 shrink-0 items-center gap-2.5 rounded-md px-2.5 text-sm whitespace-nowrap text-foreground/80 transition-colors outline-none hover:bg-foreground/5 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-[status=active]:bg-foreground/[0.07] data-[status=active]:font-medium data-[status=active]:text-foreground [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

/** One link in a section's navigation column. */
export const SectionNavLink = createLink(SectionNavAnchor);
