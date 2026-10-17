import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "@/client/components/SettingsSection";
import { everyAppAccountQueryOptions } from "@/client/components/Sidebar";
import { Button } from "@/client/components/ui/button";
import { CodeBlock } from "@/client/features/settings/CodeBlock";

/**
 * Settings → API Keys: the CRM's REST API and how to call it. Tokens are
 * made and revoked on the Every App gateway; the CRM keeps no keys of its
 * own.
 */
export function ApiSettings() {
  const { data: account } = useQuery(everyAppAccountQueryOptions());
  // The page renders in the browser (the app shell waits for the workspace),
  // where this CRM's origin is the one scripts call.
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const tokensUrl = account?.gatewayUrl
    ? `${account.gatewayUrl}/admin/tokens`
    : null;
  const example = [
    `curl ${origin}/api/v1/companies/search \\`,
    `  -H "Authorization: Bearer $EVERYAPP_TOKEN" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"q": "acme"}'`,
  ].join("\n");

  return (
    <SettingsPage
      title="API Keys"
      description="Personal keys for calling the CRM API. Each one acts as you — anything it can read or change is exactly what you can."
    >
      <SettingsSection title="REST API">
        <SettingsCard>
          <SettingsRow
            label="Personal access tokens"
            description="Made in Admin → Tokens on your Every App gateway, which shows each one once. Limit it to this CRM. Only owners and admins can open Tokens today."
          >
            {tokensUrl ? (
              <Button
                variant="outline"
                nativeButton={false}
                render={<a href={tokensUrl} target="_blank" rel="noreferrer" />}
              >
                Open Tokens on Every App
                <ExternalLink data-icon="inline-end" aria-hidden />
              </Button>
            ) : null}
          </SettingsRow>
          <SettingsRow stacked label="Try it">
            <CodeBlock
              value={example}
              successMessage="Command copied"
              wrap={false}
            />
          </SettingsRow>
          <SettingsRow
            label="OpenAPI document"
            description="Every endpoint, with its parameters."
          >
            <Button
              variant="outline"
              nativeButton={false}
              render={
                <a
                  href={`${origin}/api/v1/openapi.json`}
                  target="_blank"
                  rel="noreferrer"
                />
              }
            >
              Open
              <ExternalLink data-icon="inline-end" aria-hidden />
            </Button>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  );
}
