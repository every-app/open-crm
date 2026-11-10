import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsLayout,
});

// The router sets `data-status="active"` and `aria-current="page"` on the
// link that matches the current URL.
const linkClass =
  "inline-flex h-8 items-center rounded-md px-2.5 text-sm whitespace-nowrap text-muted-foreground transition-colors outline-none hover:bg-foreground/5 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-[status=active]:bg-foreground/[0.07] data-[status=active]:font-medium data-[status=active]:text-foreground";

/** Settings: its two pages as a strip of links, lined up with their content. */
function SettingsLayout() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border px-4 py-2 md:px-10">
        <nav aria-label="Settings" className="mx-auto flex max-w-3xl gap-1">
          <Link
            to="/settings"
            activeOptions={{ exact: true, includeSearch: false }}
            className={linkClass}
          >
            Workspace
          </Link>
          <Link
            to="/settings/connections"
            activeOptions={{ includeSearch: false }}
            className={linkClass}
          >
            Connections
          </Link>
        </nav>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  );
}
