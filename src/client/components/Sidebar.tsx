import { Link, useLocation } from "@tanstack/react-router";
import type { LinkOptions } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { ComponentType } from "react";
import { LogOut, User } from "lucide-react";
import { navItems } from "@/client/navigation/items";
import { ThemePreferenceRadio } from "@/client/components/ThemePreferenceMenuItems";
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
  SidebarMenuSkeleton,
  useSidebar,
} from "@/client/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";

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
  related,
  linkProps,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  /** Another path prefix that counts as this item, as /agents does for Chat. */
  related?: string;
  linkProps: LinkOptions;
}) {
  const { setOpenMobile } = useSidebar();
  const pathname = useLocation({ select: (location) => location.pathname });
  const inRelated = related !== undefined && pathname.startsWith(related);
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
            isActive={isActive || inRelated}
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
  workspaceName,
  header,
}: {
  workspaceName: string | null;
  /** Rendered under the workspace name: the quick search. */
  header?: React.ReactNode;
}) {
  const { setOpenMobile } = useSidebar();

  return (
    <UiSidebar variant="inset" collapsible="offcanvas" className="md:!p-0">
      <SidebarHeader className="gap-0 px-3 pb-1 pt-3">
        <Link
          to="/"
          onClick={() => setOpenMobile(false)}
          className="truncate px-1 pb-2 text-base font-semibold text-sidebar-foreground"
        >
          {workspaceName ?? "CRM"}
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
                    related={item.related}
                    linkProps={item.link}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </nav>
      </SidebarContent>
      <AccountFooter />
    </UiSidebar>
  );
}

// The Every App gateway owns sign-in, organizations and teams: the menu shows
// the person from the signed identity, no switcher, and signing out happens
// on the gateway.
function AccountFooter() {
  const accountQuery = useQuery(everyAppAccountQueryOptions());
  const account = accountQuery.data;

  return (
    <UiSidebarFooter className="gap-0 border-t border-sidebar-border pb-safe">
      <SidebarMenu>
        {account ? (
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    className={navButtonClass}
                    aria-label="Open account menu"
                  />
                }
              >
                <User className="size-4" />
                <span className="truncate">{account.email}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" className="w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Theme</DropdownMenuLabel>
                  <div className="px-1 pb-1">
                    <ThemePreferenceRadio />
                  </div>
                </DropdownMenuGroup>
                {account.gatewayUrl ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      render={<a href={account.gatewayUrl} />}
                    >
                      <LogOut className="size-4" />
                      Sign out on Every App
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        ) : (
          // The account row's slot while the identity loads.
          <SidebarMenuItem>
            <SidebarMenuSkeleton showIcon />
          </SidebarMenuItem>
        )}
      </SidebarMenu>
    </UiSidebarFooter>
  );
}
