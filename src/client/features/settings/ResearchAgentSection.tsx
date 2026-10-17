import { useQuery } from "@tanstack/react-query";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from "@/client/components/SettingsSection";
import { Skeleton } from "@/client/components/ui/skeleton";
import { GatewayKeyRow } from "@/client/features/settings/GatewayKeyRow";
import { agentModelQueryOptions } from "@/client/features/settings/settingsQueries";

/**
 * Settings → General: the model the research agent thinks with, and whether
 * the gateway holds the key that reaches it. The model isn't picked here: it
 * is Luna, or a self-hosted copy's OPENROUTER_MODEL.
 */
export function ResearchAgentSection() {
  const model = useQuery(agentModelQueryOptions());

  return (
    <SettingsSection
      title="Research agent"
      description="The model the agent thinks with, routed through OpenRouter on your Every App gateway."
    >
      <SettingsCard>
        <SettingsRow label="Model">
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
