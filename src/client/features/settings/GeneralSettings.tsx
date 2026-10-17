import { useQuery } from "@tanstack/react-query";
import {
  SettingsCard,
  SettingsPage,
  SettingsSection,
} from "@/client/components/SettingsSection";
import { ArchivedRecordsSection } from "@/client/features/settings/ArchivedRecordsSection";
import { GatewayKeyRow } from "@/client/features/settings/GatewayKeyRow";
import { ResearchAgentSection } from "@/client/features/settings/ResearchAgentSection";
import { useCanManageWorkspace } from "@/client/features/settings/settingsQueries";
import { WorkspaceSettingsCard } from "@/client/features/workspace/WorkspaceForm";
import { workspaceQueryOptions } from "@/client/features/workspace/workspaceQueries";

/** Settings → General, as the original CRM groups it. */
export function GeneralSettings() {
  const { data: workspace } = useQuery(workspaceQueryOptions());
  const canManage = useCanManageWorkspace();

  return (
    <SettingsPage
      title="General"
      description="Who you are, and the model the research agent thinks with."
    >
      {workspace ? (
        <SettingsSection
          title="Workspace"
          description="The name and website of the company using this CRM."
        >
          <WorkspaceSettingsCard workspace={workspace} canManage={canManage} />
        </SettingsSection>
      ) : null}

      <SettingsSection
        title="Company research"
        description="What the agents use to research every company in the CRM."
      >
        <SettingsCard>
          <GatewayKeyRow id="context" label="Context API key" />
        </SettingsCard>
      </SettingsSection>

      <ArchivedRecordsSection />
      <ResearchAgentSection />
    </SettingsPage>
  );
}
