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
    <SettingsPage title="General">
      {workspace ? (
        <SettingsSection title="Workspace">
          <WorkspaceSettingsCard workspace={workspace} canManage={canManage} />
        </SettingsSection>
      ) : null}

      <SettingsSection title="Company research">
        <SettingsCard>
          <GatewayKeyRow id="context" label="Context API key" />
        </SettingsCard>
      </SettingsSection>

      <ArchivedRecordsSection />
      <ResearchAgentSection />
    </SettingsPage>
  );
}
