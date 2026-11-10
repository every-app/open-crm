import { useQuery } from "@tanstack/react-query";
import { ExportAllRow } from "@/client/features/csv/ExportAllSection";
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "@/client/components/SettingsSection";
import { ThemePreferenceRadio } from "@/client/components/ThemePreferenceMenuItems";
import { ArchiveRetentionRow } from "@/client/features/settings/ArchiveRetentionRow";
import { SettingsDisclosure } from "@/client/components/SettingsDisclosure";
import { MembersSettings } from "./MembersSettings";
import { CurrencySettings } from "./CurrencySettings";
import { DealsSetting } from "./DealsSetting";
import { useCanManageWorkspace } from "@/client/features/settings/settingsQueries";
import { WorkspaceSettingsCard } from "@/client/features/workspace/WorkspaceForm";
import { workspaceQueryOptions } from "@/client/features/workspace/workspaceQueries";
import { hasOrgPermission } from "@/shared/org-permissions";

/**
 * Settings → Workspace: the workspace itself, who is in it, and its data.
 * Currencies only matter to deals, so they show while deals are on.
 */
export function GeneralSettings() {
  const { data: workspace } = useQuery(workspaceQueryOptions());
  const canManage = useCanManageWorkspace();
  // The app shell renders its pages once the workspace has loaded.
  if (!workspace) return null;

  return (
    <SettingsPage
      title="Workspace"
      description={
        canManage
          ? undefined
          : "Only an owner or an admin can change workspace settings."
      }
    >
      <WorkspaceSettingsCard workspace={workspace} canManage={canManage}>
        <DealsSetting enabled={workspace.dealsEnabled} canManage={canManage} />
        <SettingsRow label="Theme" description="For this browser.">
          <ThemePreferenceRadio />
        </SettingsRow>
      </WorkspaceSettingsCard>

      <MembersSettings />
      {workspace.dealsEnabled ? (
        <SettingsDisclosure id="currencies" title="Currencies">
          <CurrencySettings />
        </SettingsDisclosure>
      ) : null}

      <SettingsSection title="Data">
        <SettingsCard>
          <ArchiveRetentionRow />
          {hasOrgPermission(workspace.role, { workspace: ["export"] }) ? (
            <ExportAllRow />
          ) : null}
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  );
}
