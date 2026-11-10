import { useId } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SettingsRow } from "@/client/components/SettingsSection";
import { Switch } from "@/client/components/ui/switch";
import { workspaceQueryOptions } from "@/client/features/workspace/workspaceQueries";
import { setDealsEnabled } from "@/serverFunctions/workspace";

/**
 * Settings → Workspace: whether the workspace tracks deals. Off hides the
 * Deals page, the deal sections and the Overview's sales charts; nothing
 * is deleted, so turning it back on shows everything as it was.
 */
export function DealsSetting({
  enabled,
  canManage,
}: {
  enabled: boolean;
  canManage: boolean;
}) {
  const id = useId();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (next: boolean) => setDealsEnabled({ data: { enabled: next } }),
    onSuccess: () =>
      Promise.all(
        [workspaceQueryOptions().queryKey, ["dashboard"]].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      ),
  });

  return (
    <SettingsRow
      label="Deals"
      htmlFor={id}
      description="Track sales with amounts, close dates and a pipeline. Turning them off hides deals; nothing is deleted."
    >
      <Switch
        id={id}
        checked={mutation.isPending ? mutation.variables : enabled}
        disabled={!canManage || mutation.isPending}
        onCheckedChange={(next) => mutation.mutate(next)}
      />
    </SettingsRow>
  );
}
