import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { CopyButton } from "@/client/components/CopyButton";
import { SettingsRow } from "@/client/components/SettingsSection";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Skeleton } from "@/client/components/ui/skeleton";
import { useCanManageWorkspace } from "@/client/features/settings/settingsQueries";
import { setupChecklistQueryOptions } from "@/client/features/setup/setupQueries";

const STATUS = {
  done: { label: "Connected", variant: "success" },
  checking: { label: "Not checked yet", variant: "secondary" },
  missing: { label: "Not set up", variant: "warning" },
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
  const queryClient = useQueryClient();
  const query = useQuery(setupChecklistQueryOptions());
  const checklist = query.data;
  const item = checklist?.items.find((entry) => entry.id === id);

  if (!checklist || !item) {
    return (
      <SettingsRow label={label}>
        {query.isError ? null : <Skeleton className="h-5 w-24" />}
      </SettingsRow>
    );
  }

  const status = STATUS[item.state];

  return (
    <SettingsRow
      label={label}
      description={
        item.note || item.command ? (
          <div className="space-y-2">
            {item.note ? <p>{item.note}</p> : null}
            {item.command ? (
              <>
                {/* An owner or admin runs it; a member knows what to ask for.
                    While "checking" (the gateway is connected, nothing has
                    asked the model yet) the key may already be there. */}
                <p>
                  {item.state === "checking"
                    ? canManage
                      ? "If it isn't set yet, run from your Every App checkout:"
                      : "If it isn't set yet, ask an owner or admin to run:"
                    : canManage
                      ? "Run from your Every App checkout:"
                      : "Ask an owner or admin to run:"}
                </p>
                <SetupCommand command={item.command} label={label} />
              </>
            ) : null}
          </div>
        ) : undefined
      }
    >
      <Badge variant={status.variant}>{status.label}</Badge>
      {item.state === "missing" ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          aria-label={`Refresh ${label} status`}
          title={`Refresh ${label} status`}
          disabled={query.isFetching}
          aria-busy={query.isFetching || undefined}
          onClick={() => {
            void query.refetch();
            void queryClient.invalidateQueries({
              queryKey: ["settings", "agent-status"],
            });
          }}
        >
          <RefreshCw
            aria-hidden
            className={
              query.isFetching ? "motion-safe:animate-spin" : undefined
            }
          />
        </Button>
      ) : null}
    </SettingsRow>
  );
}

/** A command that sets something up, with a button that copies it. */
export function SetupCommand({
  command,
  label,
}: {
  command: string;
  label: string;
}) {
  return (
    <div className="flex max-w-full items-center gap-2">
      <code className="min-w-0 truncate rounded-md bg-muted px-2 py-1 font-mono text-xs text-foreground">
        {command}
      </code>
      <CopyButton
        value={command}
        successMessage="Copied."
        label={`Copy the command that sets up ${label}`}
        size="icon-xs"
        variant="ghost"
      />
    </div>
  );
}
