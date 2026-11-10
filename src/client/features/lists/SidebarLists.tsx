import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { cn } from "cn";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/client/components/ui/sidebar";
import { CreateListDialog } from "@/client/features/lists/ListDialog";
import { LIST_DOT } from "@/client/features/lists/listColors";
import { listsQueryOptions } from "@/client/features/lists/listQueries";

const rowClass =
  "relative text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground data-active:before:absolute data-active:before:inset-y-1 data-active:before:left-0 data-active:before:w-[3px] data-active:before:rounded-r-full data-active:before:bg-primary";

/**
 * The sidebar's Lists: each live list with how many are in it (and how many
 * are Due), opening in the contacts or companies page; "+" makes one.
 */
export function SidebarLists({ onNavigate }: { onNavigate: () => void }) {
  const lists = useQuery(listsQueryOptions());
  const openList = useLocation({
    select: (location) =>
      typeof location.search.list === "string" ? location.search.list : null,
  });
  const [creating, setCreating] = useState(false);

  return (
    <SidebarGroup className="py-1">
      <SidebarGroupLabel>Lists</SidebarGroupLabel>
      <SidebarGroupAction
        // On the label's centre line: this group's padding is py-1.
        className="top-2.5"
        title="New list"
        aria-label="New list"
        onClick={() => setCreating(true)}
      >
        <Plus />
      </SidebarGroupAction>
      <SidebarGroupContent>
        <SidebarMenu>
          {lists.data?.map((list) => (
            <SidebarMenuItem key={list.id}>
              <SidebarMenuButton
                isActive={openList === list.id}
                className={rowClass}
                render={
                  <Link
                    to={list.entity === "CONTACT" ? "/contacts" : "/companies"}
                    search={{ list: list.id }}
                    onClick={onNavigate}
                  />
                }
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    LIST_DOT[list.color],
                  )}
                />
                <span className="truncate">{list.name}</span>
                {/* In the row's own layout, so a long name truncates before them. */}
                <span className="ml-auto flex shrink-0 items-center gap-1 text-xs font-normal tabular-nums">
                  {list.due > 0 ? (
                    <span className="rounded bg-amber-500/15 px-1 text-amber-700 dark:text-amber-400">
                      {list.due} due
                    </span>
                  ) : null}
                  <span className="opacity-80">
                    {list.total.toLocaleString()}
                    <span className="sr-only"> in it</span>
                  </span>
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
          {lists.data?.length === 0 ? (
            <SidebarMenuItem>
              <SidebarMenuButton
                className={cn(rowClass, "text-sidebar-foreground/50")}
                onClick={() => setCreating(true)}
              >
                <Plus className="size-4" />
                <span>New list</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}
        </SidebarMenu>
      </SidebarGroupContent>
      {creating ? (
        <CreateListDialog onClose={() => setCreating(false)} />
      ) : null}
    </SidebarGroup>
  );
}
