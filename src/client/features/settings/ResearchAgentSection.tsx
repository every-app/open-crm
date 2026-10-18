import { useQuery } from "@tanstack/react-query";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from "@/client/components/SettingsSection";
import { Skeleton } from "@/client/components/ui/skeleton";
import {
  GatewayKeyRow,
  SetupCommand,
} from "@/client/features/settings/GatewayKeyRow";
import {
  agentModelQueryOptions,
  useCanManageWorkspace,
} from "@/client/features/settings/settingsQueries";
import { setupChecklistQueryOptions } from "@/client/features/setup/setupQueries";

const MODEL_SETTING = "OPENROUTER_MODEL";

/**
 * Settings → General, on a self-hosted copy: the model the research agent
 * thinks with and where to change it (OPENROUTER_MODEL), and whether the
 * gateway holds the key that reaches it.
 */
export function ResearchAgentSection() {
  const checklist = useQuery(setupChecklistQueryOptions()).data;
  const canManage = useCanManageWorkspace();
  const model = useQuery(agentModelQueryOptions());

  return (
    <SettingsSection title="Research agent">
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
        <GatewayKeyRow id="model" label="Model key" />
      </SettingsCard>
    </SettingsSection>
  );
}
