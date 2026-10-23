import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from "@/client/components/SettingsSection";
import { everyAppAccountQueryOptions } from "@/client/components/Sidebar";
import { Button } from "@/client/components/ui/button";
import { useCanManageWorkspace } from "./settingsQueries";

/** The gateway owns invitations, membership and roles. */
export function MembersSettings() {
  const { data: account } = useQuery(everyAppAccountQueryOptions());
  const canManage = useCanManageWorkspace();
  return (
    <SettingsSection id="members" title="Members">
      <SettingsCard>
        <SettingsRow
          label="Team access"
          description={
            canManage
              ? "Manage members, roles and invitations on Every App."
              : "Ask an owner or admin to manage members on Every App."
          }
        >
          {canManage && account?.gatewayUrl ? (
            <Button
              variant="outline"
              nativeButton={false}
              render={
                <a
                  href={`${account.gatewayUrl}/admin/users`}
                  target="_blank"
                  rel="noreferrer"
                />
              }
            >
              Manage members
              <ExternalLink data-icon="inline-end" aria-hidden />
            </Button>
          ) : null}
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  );
}
