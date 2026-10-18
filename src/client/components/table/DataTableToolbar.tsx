import type { ReactNode } from "react";
import { Tabs, TabsList } from "@/client/components/ui/tabs";

// The parts above a `DataTable`: a tab row and a toolbar row. The page owns
// the filter values.

/**
 * Tabs that switch what the table shows, as the first row of its card. Pass
 * `TabsTrigger`s as children and actions such as `ExportMenu` in `actions`.
 */
export function DataTableTabs({
  value,
  onValueChange,
  actions,
  description,
  children,
}: {
  value: string;
  onValueChange: (value: string) => void;
  actions?: ReactNode;
  /** A short note about the active tab, under the tabs. */
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3 border-b border-border px-4 pt-3 pb-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Tabs value={value} onValueChange={onValueChange}>
          <TabsList
            variant="line"
            className="h-auto! flex-wrap justify-start *:flex-none"
          >
            {children}
          </TabsList>
        </Tabs>
        {actions}
      </div>
      {description ? (
        <div className="text-sm text-muted-foreground">{description}</div>
      ) : null}
    </div>
  );
}

/** Filter controls above the rows, wrapping as they need. */
export function DataTableToolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
      {children}
    </div>
  );
}
