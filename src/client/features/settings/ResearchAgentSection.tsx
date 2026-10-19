import { useId } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from "@/client/components/SettingsSection";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Switch } from "@/client/components/ui/switch";
import {
  GatewayKeyRow,
  SetupCommand,
} from "@/client/features/settings/GatewayKeyRow";
import {
  agentModelQueryOptions,
  automaticResearchQueryOptions,
  useCanManageWorkspace,
} from "@/client/features/settings/settingsQueries";
import { setupChecklistQueryOptions } from "@/client/features/setup/setupQueries";
import { setAutomaticResearch } from "@/serverFunctions/settings";

const MODEL_SETTING = "OPENROUTER_MODEL";

/**
 * Settings → General: whether the research agent researches on its own, the
 * model it thinks with, where to change it (OPENROUTER_MODEL), and whether
 * the gateway holds the key that reaches it.
 */
export function ResearchAgentSection() {
  return (
    <SettingsSection title="Research agent">
      <SettingsCard>
        <AutomaticResearchRow />
        <ModelRows />
      </SettingsCard>
    </SettingsSection>
  );
}

function AutomaticResearchRow() {
  const id = useId();
  const canManage = useCanManageWorkspace();
  const queryClient = useQueryClient();
  const query = useQuery(automaticResearchQueryOptions());
  const mutation = useMutation({
    mutationFn: (enabled: boolean) =>
      setAutomaticResearch({ data: { enabled } }),
    // The agent's status says whether it researches on its own too.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["settings"] }),
  });

  return (
    <SettingsRow label="Research automatically" htmlFor={id}>
      {query.data ? (
        <Switch
          id={id}
          checked={
            mutation.isPending
              ? (mutation.variables ?? query.data.enabled)
              : query.data.enabled
          }
          disabled={!canManage || mutation.isPending}
          onCheckedChange={(enabled) => mutation.mutate(enabled)}
        />
      ) : query.isError ? null : (
        <Skeleton className="h-5 w-8" />
      )}
    </SettingsRow>
  );
}

function ModelRows() {
  const checklist = useQuery(setupChecklistQueryOptions()).data;
  const canManage = useCanManageWorkspace();
  const model = useQuery(agentModelQueryOptions());

  return (
    <>
      <SettingsRow
        label="Model"
        description={
          checklist?.local ? (
            `In local development, put ${MODEL_SETTING} in .dev.vars.`
          ) : canManage ? (
            <SetupCommand
              command={`pnpm everyapp secret set ${MODEL_SETTING}`}
              label="the model"
            />
          ) : undefined
        }
      >
        {model.data ? (
          <span className="font-mono text-sm">{model.data.id}</span>
        ) : model.isError ? null : (
          <Skeleton className="h-5 w-40" />
        )}
      </SettingsRow>
      <GatewayKeyRow id="model" label="Model key" />
    </>
  );
}
