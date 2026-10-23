import { useId } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from "@/client/components/SettingsSection";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Switch } from "@/client/components/ui/switch";
import { SettingsDisclosure } from "@/client/components/SettingsDisclosure";
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
        <GatewayKeyRow id="model" label="OpenRouter API key" />
      </SettingsCard>
      <ModelSettings />
    </SettingsSection>
  );
}

function AutomaticResearchRow() {
  const id = useId();
  const canManage = useCanManageWorkspace();
  const queryClient = useQueryClient();
  const query = useQuery(automaticResearchQueryOptions());
  const checklist = useQuery(setupChecklistQueryOptions());
  const state = checklist.data?.items.find(
    (item) => item.id === "model",
  )?.state;
  const available = state === "done" || state === "checking";
  const mutation = useMutation({
    mutationFn: (enabled: boolean) =>
      setAutomaticResearch({ data: { enabled } }),
    // The agent's status says whether it researches on its own too.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["settings"] }),
  });

  return (
    <SettingsRow
      label="Research automatically"
      htmlFor={id}
      description={
        state === "checking"
          ? "The first research run will verify the model connection."
          : available
            ? undefined
            : "Available after your model is connected."
      }
    >
      {query.data ? (
        <Switch
          id={id}
          checked={
            available &&
            (mutation.isPending
              ? (mutation.variables ?? query.data.enabled)
              : query.data.enabled)
          }
          disabled={!canManage || !available || mutation.isPending}
          onCheckedChange={(enabled) => mutation.mutate(enabled)}
        />
      ) : query.isError ? null : (
        <Skeleton className="h-5 w-8" />
      )}
    </SettingsRow>
  );
}

function ModelSettings() {
  const checklist = useQuery(setupChecklistQueryOptions()).data;
  const canManage = useCanManageWorkspace();
  const model = useQuery(agentModelQueryOptions());

  return (
    <SettingsDisclosure id="research-model" title="Model settings">
      <SettingsCard>
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
      </SettingsCard>
    </SettingsDisclosure>
  );
}
