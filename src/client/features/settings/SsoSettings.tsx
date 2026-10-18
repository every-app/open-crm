import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
} from "@/client/components/SettingsSection";
import { everyAppAccountQueryOptions } from "@/client/components/Sidebar";
import { Button } from "@/client/components/ui/button";
import { setupChecklistQueryOptions } from "@/client/features/setup/setupQueries";

/**
 * Settings → SSO. The Every App gateway signs people in, so single sign-on
 * is the gateway's: a self-hosted gateway can sign people in through
 * Cloudflare Access, and the hosted one doesn't offer it yet.
 */
export function SsoSettings() {
  const account = useQuery(everyAppAccountQueryOptions());
  const setup = useQuery(setupChecklistQueryOptions());
  const hosted = setup.data?.tier === "first_party";
  const gatewayUrl = account.data?.gatewayUrl;

  return (
    <SettingsPage title="SSO">
      <SettingsCard>
        <SettingsRow
          label="Single sign-on"
          description={
            hosted
              ? "Not available on the hosted gateway yet."
              : "Your Every App gateway can sign people in through Cloudflare Access, with any SAML or OIDC provider."
          }
        >
          {gatewayUrl ? (
            <Button
              variant="outline"
              nativeButton={false}
              render={<a href={gatewayUrl} target="_blank" rel="noreferrer" />}
            >
              Open Every App
              <ExternalLink data-icon="inline-end" aria-hidden />
            </Button>
          ) : null}
        </SettingsRow>
      </SettingsCard>
    </SettingsPage>
  );
}
