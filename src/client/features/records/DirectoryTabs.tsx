import type { ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/client/components/ui/tabs";

export enum DirectoryView {
  Companies = "companies",
  Contacts = "contacts",
}

/** Two record types in one directory; each keeps its own list and URL. */
export function DirectoryTabs({
  view,
  children,
}: {
  view: DirectoryView;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <Tabs
      className="min-h-0 flex-1 gap-4"
      value={view}
      onValueChange={(value) => {
        if (value === DirectoryView.Companies)
          void navigate({ to: "/companies" });
        else if (value === DirectoryView.Contacts)
          void navigate({ to: "/contacts" });
      }}
    >
      <TabsList aria-label="Directory views">
        <TabsTrigger value={DirectoryView.Companies}>Companies</TabsTrigger>
        <TabsTrigger value={DirectoryView.Contacts}>Contacts</TabsTrigger>
      </TabsList>
      <TabsContent value={view} className="flex min-h-0 flex-1 flex-col">
        {children}
      </TabsContent>
    </Tabs>
  );
}
