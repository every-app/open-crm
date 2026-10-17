import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, CircleDashed, Clock3, X } from "lucide-react";
import { cn } from "cn";
import { CopyButton } from "@/client/components/CopyButton";
import { QueryState } from "@/client/components/QueryState";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/client/components/ui/card";
import { useCanManageWorkspace } from "@/client/features/settings/settingsQueries";
import { dismissSetupChecklist } from "@/serverFunctions/setup";
import type { getSetupChecklist } from "@/serverFunctions/setup";
import { setupChecklistQueryOptions } from "./setupQueries";

type Checklist = Awaited<ReturnType<typeof getSetupChecklist>>;
type Item = Checklist["items"][number];

const STATE = {
  done: { icon: CircleCheck, className: "text-success", badge: "Ready" },
  checking: {
    icon: Clock3,
    className: "text-muted-foreground",
    badge: "Not checked yet",
  },
  missing: {
    icon: CircleDashed,
    className: "text-warning",
    badge: "Not set up",
  },
} as const;

const BADGE_VARIANT = {
  done: "success",
  checking: "secondary",
  missing: "warning",
} as const;

/**
 * On Home, for owners and admins of a workspace that isn't fully set up:
 * what this gateway has and what each piece unlocks. Gone once everything is
 * set up or an owner or admin puts it away; Settings → Setup keeps it.
 */
export function HomeSetupChecklist() {
  const canManage = useCanManageWorkspace();
  const query = useQuery({
    ...setupChecklistQueryOptions(),
    enabled: canManage,
  });
  const queryClient = useQueryClient();
  const dismiss = useMutation({
    mutationFn: () => dismissSetupChecklist(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["setup", "checklist"] }),
  });
  const checklist = query.data;
  if (!canManage || !checklist || checklist.complete || checklist.dismissed) {
    return null;
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Finish setting up</CardTitle>
        <CardDescription>
          The CRM works without these. Each one your Every App gateway holds
          unlocks more of it.
        </CardDescription>
        <CardAction>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Hide the setup checklist"
            title="Hide (Settings → Setup keeps it)"
            pending={dismiss.isPending}
            onClick={() => dismiss.mutate()}
          >
            <X />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <SetupItems
          items={checklist.items}
          tier={checklist.tier}
          local={checklist.local}
        />
      </CardContent>
    </Card>
  );
}

/** Settings: every item, or those of one `group`, always shown. */
export function SetupChecklist({ group }: { group?: Item["group"] }) {
  const query = useQuery(setupChecklistQueryOptions());
  return (
    <QueryState query={query} errorFallback="The setup could not be loaded.">
      {(checklist) => (
        <Card className="max-w-2xl">
          <CardContent>
            <SetupItems
              items={checklist.items.filter(
                (item) => !group || item.group === group,
              )}
              tier={checklist.tier}
              local={checklist.local}
            />
          </CardContent>
        </Card>
      )}
    </QueryState>
  );
}

function SetupItems({
  items,
  tier,
  local,
}: {
  items: Item[];
  tier: Checklist["tier"];
  local: boolean;
}) {
  const canManage = useCanManageWorkspace();
  return (
    <ul className="divide-y divide-border">
      {items.map((item) => {
        const state = STATE[item.state];
        const Icon = state.icon;
        return (
          <li key={item.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
            <Icon
              aria-hidden
              className={cn("mt-0.5 size-4 shrink-0", state.className)}
            />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.unlocks}
                  </p>
                </div>
                {item.optional && item.state === "missing" ? (
                  <Badge variant="secondary">Optional</Badge>
                ) : (
                  <Badge variant={BADGE_VARIANT[item.state]}>
                    {state.badge}
                  </Badge>
                )}
              </div>
              {item.note ? (
                <p className="text-xs text-muted-foreground">{item.note}</p>
              ) : null}
              {item.command ? (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    Set it once on the gateway, from your CRM checkout:
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1 font-mono text-xs">
                      {item.command}
                    </code>
                    <CopyButton
                      value={item.command}
                      successMessage="Command copied"
                      label={`Copy the command that sets up ${item.title}`}
                      size="icon-xs"
                      variant="ghost"
                    />
                  </div>
                </div>
              ) : item.state === "missing" && !local ? (
                <p className="text-xs text-muted-foreground">
                  {tier === "first_party"
                    ? "Every App runs this gateway; it isn't offered here yet."
                    : canManage
                      ? null
                      : "An owner or admin of the workspace sets it up on the gateway."}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
