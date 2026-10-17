import { useQuery } from "@tanstack/react-query";
import { CopyButton } from "@/client/components/CopyButton";
import { SettingsRow } from "@/client/components/SettingsSection";
import { Badge } from "@/client/components/ui/badge";
import { Skeleton } from "@/client/components/ui/skeleton";
import { useCanManageWorkspace } from "@/client/features/settings/settingsQueries";
import { setupChecklistQueryOptions } from "@/client/features/setup/setupQueries";

const STATUS = {
  done: { label: "Connected", variant: "success" },
  checking: { label: "Not checked yet", variant: "secondary" },
  missing: { label: "Not connected", variant: "warning" },
} as const;

/**
 * A key the Every App gateway holds for the CRM, as one settings row: whether
 * it is there and, while it isn't, how it gets there.
 */
export function GatewayKeyRow({
  id,
  label,
}: {
  id: "model" | "context";
  label: string;
}) {
  const canManage = useCanManageWorkspace();
  const query = useQuery(setupChecklistQueryOptions());
  const checklist = query.data;
  const item = checklist?.items.find((entry) => entry.id === id);

  if (!checklist || !item) {
    return (
      <SettingsRow label={label} description="Held by your Every App gateway.">
        {query.isError ? null : <Skeleton className="h-5 w-24" />}
      </SettingsRow>
    );
  }

  const status = STATUS[item.state];
  // Who sets it, for a member of a fork; an owner or admin gets the command.
  const fallback =
    item.state === "missing" &&
    !checklist.local &&
    checklist.tier === "fork" &&
    !canManage
      ? "An owner or an admin sets it up on the gateway."
      : null;

  return (
    <SettingsRow
      label={label}
      description={
        <div className="space-y-2">
          <p>Held by your Every App gateway.</p>
          {item.note ? <p>{item.note}</p> : null}
          {fallback ? <p>{fallback}</p> : null}
          {item.command ? (
            <div className="flex max-w-full items-center gap-2">
              <code className="min-w-0 truncate rounded-md bg-muted px-2 py-1 font-mono text-xs text-foreground">
                {item.command}
              </code>
              <CopyButton
                value={item.command}
                successMessage="Command copied"
                label={`Copy the command that sets up ${label}`}
                size="icon-xs"
                variant="ghost"
              />
            </div>
          ) : null}
        </div>
      }
    >
      <Badge variant={status.variant}>{status.label}</Badge>
    </SettingsRow>
  );
}
