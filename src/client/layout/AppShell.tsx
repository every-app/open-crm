import type * as React from "react";
import { PRODUCT_NAME } from "@/client/lib/page-title";
import { Link } from "@tanstack/react-router";
import { Sidebar } from "@/client/components/Sidebar";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/client/components/ui/sidebar";

export function AppLayout({
  children,
  workspaceName,
  sidebarHeader,
}: {
  children: React.ReactNode;
  workspaceName: string | null;
  sidebarHeader?: React.ReactNode;
}) {
  return (
    <SidebarProvider className="h-[100dvh] min-h-0 overflow-hidden">
      <Sidebar workspaceName={workspaceName} header={sidebarHeader} />
      <SidebarInset className="min-h-0 overflow-hidden md:!m-0 md:!mt-2 md:!rounded-none md:!rounded-tl-lg md:border-l md:border-t md:border-sidebar-border md:!shadow-none">
        <MobileTopBar workspaceName={workspaceName} />
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function MobileTopBar({ workspaceName }: { workspaceName: string | null }) {
  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-border bg-card px-2 py-1.5 md:hidden">
      <SidebarTrigger aria-label="Toggle sidebar" />
      <Link to="/" className="ml-1 truncate font-semibold text-foreground">
        {workspaceName ?? PRODUCT_NAME}
      </Link>
    </div>
  );
}
