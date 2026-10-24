import { useQuery } from "@tanstack/react-query";
import { ExportAllSection } from "@/client/features/csv/ExportAllSection";
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "@/client/components/SettingsSection";
import { ThemePreferenceRadio } from "@/client/components/ThemePreferenceMenuItems";
import { ArchivedRecordsSection } from "@/client/features/settings/ArchivedRecordsSection";
import { SettingsDisclosure } from "@/client/components/SettingsDisclosure";
import { MembersSettings } from "./MembersSettings";
import { CurrencySettings } from "./CurrencySettings";
import { useCanManageWorkspace } from "@/client/features/settings/settingsQueries";
import { WorkspaceSettingsCard } from "@/client/features/workspace/WorkspaceForm";
import { workspaceQueryOptions } from "@/client/features/workspace/workspaceQueries";
import { hasOrgPermission } from "@/shared/org-permissions";

/** Settings → General, as the original CRM groups it. */
export function GeneralSettings() {
  const { data: workspace } = useQuery(workspaceQueryOptions());
  const canManage = useCanManageWorkspace();

  return (
    <SettingsPage title="Workspace">
      {workspace ? (
        <WorkspaceSettingsCard workspace={workspace} canManage={canManage} />
      ) : null}

      <SettingsSection title="Appearance">
        <SettingsCard>
          <SettingsRow label="Theme" description="For this browser.">
            <ThemePreferenceRadio />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <ArchivedRecordsSection />
      <MembersSettings />
      <SettingsDisclosure id="currencies" title="Currencies">
        <CurrencySettings />
      </SettingsDisclosure>
      {workspace &&
      hasOrgPermission(workspace.role, { workspace: ["export"] }) ? (
        <ExportAllSection />
      ) : null}
    </SettingsPage>
  );
}
