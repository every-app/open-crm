import { Link, useLocation } from "@tanstack/react-router";
import { PRODUCT_NAME } from "@/client/lib/page-title";
import type { LinkOptions } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { ComponentType } from "react";
import { ChevronLeft } from "lucide-react";
import { cn } from "cn";
import { navItems, settingsNavItem } from "@/client/navigation/items";
import { EnrichmentQueue } from "@/client/features/agent/EnrichmentQueue";
import { getEveryAppAccount } from "@/serverFunctions/everyApp";
import {
  Sidebar as UiSidebar,
  SidebarContent,
  SidebarFooter as UiSidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/client/components/ui/sidebar";

const navButtonClass =
  "relative text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground data-active:before:absolute data-active:before:inset-y-1 data-active:before:left-0 data-active:before:w-[3px] data-active:before:rounded-r-full data-active:before:bg-primary";

export const everyAppAccountQueryOptions = () => ({
  queryKey: ["every-app-account"],
  queryFn: () => getEveryAppAccount(),
  staleTime: 5 * 60 * 1000,
});

function SidebarNavLink({
  icon: Icon,
  label,
  linkProps,
  activePaths,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  linkProps: LinkOptions;
  activePaths?: readonly string[];
}) {
  const { setOpenMobile } = useSidebar();
  const pathname = useLocation({ select: (location) => location.pathname });
  const alsoActive =
    activePaths?.some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    ) ?? false;
  return (
    <SidebarMenuItem>
      <Link
        {...linkProps}
        activeOptions={{
          exact: false,
          includeSearch: false,
          ...linkProps.activeOptions,
        }}
        onClick={() => setOpenMobile(false)}
      >
        {({ isActive }) => (
          <SidebarMenuButton
            render={<span />}
            isActive={isActive || alsoActive}
            className={navButtonClass}
          >
            <Icon className="size-4" />
            <span>{label}</span>
          </SidebarMenuButton>
        )}
      </Link>
    </SidebarMenuItem>
  );
}

export function Sidebar({
  header,
}: {
  /** Rendered under the product name: the quick search. */
  header?: React.ReactNode;
}) {
  const { setOpenMobile } = useSidebar();

  return (
    <UiSidebar variant="inset" collapsible="offcanvas" className="md:!p-0">
      <SidebarHeader className="gap-0 px-3 pb-1 pt-2">
        <EveryAppLink />
        <Link
          to="/"
          onClick={() => setOpenMobile(false)}
          className="truncate px-1 pb-2 text-base font-semibold text-sidebar-foreground"
        >
          {PRODUCT_NAME}
        </Link>
        {header}
      </SidebarHeader>

      <SidebarContent>
        <nav aria-label="Main navigation">
          <SidebarGroup className="py-1">
            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.map((item) => (
                  <SidebarNavLink
                    key={item.label}
                    icon={item.icon}
                    label={item.label}
                    linkProps={item.link}
                    activePaths={item.activePaths}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </nav>
        <EnrichmentQueue />
      </SidebarContent>
      <UiSidebarFooter className="gap-0 border-t border-sidebar-border pb-safe">
        <SidebarMenu>
          <SidebarNavLink
            icon={settingsNavItem.icon}
            label={settingsNavItem.label}
            linkProps={settingsNavItem.link}
          />
        </SidebarMenu>
      </UiSidebarFooter>
    </UiSidebar>
  );
}

/**
 * The way back up, first in the sidebar as in every Every App app: the
 * gateway owns sign-in, organizations, teams and the other apps. The row
 * keeps its height while the gateway's URL loads so the header doesn't jump.
 */
function EveryAppLink() {
  const accountQuery = useQuery(everyAppAccountQueryOptions());
  const gatewayUrl = accountQuery.data?.gatewayUrl;
  if (!accountQuery.isPending && !gatewayUrl) return null;
  return (
    <a
      href={gatewayUrl ?? undefined}
      aria-label="Back to Every App"
      className={cn(
        "mb-1 inline-flex h-7 w-fit items-center gap-0.5 rounded-md pl-0.5 pr-2 text-sm text-sidebar-foreground/60 transition-colors hover:text-sidebar-foreground",
        accountQuery.isPending && "invisible",
      )}
    >
      <ChevronLeft className="size-4" aria-hidden />
      <span>Every App</span>
    </a>
  );
}
