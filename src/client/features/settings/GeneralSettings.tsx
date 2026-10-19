import { useQuery } from "@tanstack/react-query";
import { ExportAllSection } from "@/client/features/csv/ExportAllSection";
import {
  SettingsCard,
  SettingsPage,
  SettingsSection,
} from "@/client/components/SettingsSection";
import { ArchivedRecordsSection } from "@/client/features/settings/ArchivedRecordsSection";
import { GatewayKeyRow } from "@/client/features/settings/GatewayKeyRow";
import { ResearchAgentSection } from "@/client/features/settings/ResearchAgentSection";
import { useCanManageWorkspace } from "@/client/features/settings/settingsQueries";
import { setupChecklistQueryOptions } from "@/client/features/setup/setupQueries";
import { WorkspaceSettingsCard } from "@/client/features/workspace/WorkspaceForm";
import { workspaceQueryOptions } from "@/client/features/workspace/workspaceQueries";
import { hasOrgPermission } from "@/shared/org-permissions";

/**
 * Settings → General, as the original CRM groups it. The research keys and
 * the model are a self-hosted copy's own: the hosted CRM uses Every App's,
 * so it shows neither, only whether the agent researches on its own.
 */
export function GeneralSettings() {
  const { data: workspace } = useQuery(workspaceQueryOptions());
  const canManage = useCanManageWorkspace();
  const selfHosted =
    useQuery(setupChecklistQueryOptions()).data?.tier === "fork";

  return (
    <SettingsPage title="General">
      {workspace ? (
        <SettingsSection title="Workspace">
          <WorkspaceSettingsCard workspace={workspace} canManage={canManage} />
        </SettingsSection>
      ) : null}

      {selfHosted ? (
        <SettingsSection title="Company research">
          <SettingsCard>
            <GatewayKeyRow id="context" label="Context API key" />
          </SettingsCard>
        </SettingsSection>
      ) : null}

      <ArchivedRecordsSection />
      <ResearchAgentSection selfHosted={selfHosted} />
      {workspace &&
      hasOrgPermission(workspace.role, { workspace: ["export"] }) ? (
        <ExportAllSection />
      ) : null}
    </SettingsPage>
  );
}
