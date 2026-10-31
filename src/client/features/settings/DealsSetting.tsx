import { useId } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from "@/client/components/SettingsSection";
import { Switch } from "@/client/components/ui/switch";
import { workspaceQueryOptions } from "@/client/features/workspace/workspaceQueries";
import { setDealsEnabled } from "@/serverFunctions/workspace";

/**
 * Settings → General: whether the workspace tracks deals. Off hides the
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
    onSuccess: async (_, next) => {
      await Promise.all(
        [workspaceQueryOptions().queryKey, ["dashboard"]].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      );
      toast.success(next ? "Deals are on." : "Deals are off.");
    },
  });

  return (
    <SettingsSection title="Features">
      <SettingsCard>
        <SettingsRow
          label="Deals"
          htmlFor={id}
          description={
            <>
              Track sales with amounts, close dates and a pipeline. Turning them
              off hides deals; nothing is deleted.
              {canManage ? null : (
                <> Only an owner or an admin can change this.</>
              )}
            </>
          }
        >
          <Switch
            id={id}
            checked={mutation.isPending ? mutation.variables : enabled}
            disabled={!canManage || mutation.isPending}
            onCheckedChange={(next) => mutation.mutate(next)}
          />
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  );
}
