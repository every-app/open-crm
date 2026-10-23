import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import {
  SettingsCard,
  SettingsSection,
  SettingsRow,
} from "@/client/components/SettingsSection";
import { CopyButton } from "@/client/components/CopyButton";
import { everyAppAccountQueryOptions } from "@/client/components/Sidebar";
import { Button } from "@/client/components/ui/button";
import { SettingsDisclosure } from "@/client/components/SettingsDisclosure";
import { useCanManageWorkspace } from "@/client/features/settings/settingsQueries";

const FIRST_REQUEST =
  "List the companies in my CRM, then help me add a real prospect, its first deal and a dated follow-up. Ask me for any missing details.";

/** Connect, authorize, and prove the connection with a real CRM tool result. */
export function ApiSettings() {
  const { data: account } = useQuery(everyAppAccountQueryOptions());
  const canManage = useCanManageWorkspace();
  // The page renders in the browser (the app shell waits for the workspace),
  // where this CRM's origin is the one scripts call.
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const tokensUrl = account?.gatewayUrl
    ? `${account.gatewayUrl}/admin/tokens`
    : null;
  const mcpUrl = account?.gatewayUrl
    ? `${account.gatewayUrl}/mcp`
    : origin && `${origin}/mcp`;

  return (
    <SettingsSection id="ai-clients" title="Connect your AI client">
      <SettingsCard>
        <SettingsRow
          label="1. Add a remote MCP server"
          description="Open your AI client's connection settings and add this server URL."
        >
          {mcpUrl ? (
            <div className="flex max-w-full items-center gap-2">
              <code className="min-w-0 truncate rounded-md bg-muted px-2 py-1 font-mono text-xs">
                {mcpUrl}
              </code>
              <CopyButton
                value={mcpUrl}
                successMessage="Endpoint copied"
                label="Copy the MCP endpoint"
                size="icon-xs"
                variant="ghost"
              />
            </div>
          ) : null}
        </SettingsRow>
        <SettingsRow
          label="2. Sign in"
          description={
            account?.gatewayUrl
              ? "Sign in with your Every App account and approve CRM access when your client asks."
              : "This endpoint uses bearer-token authentication. Ask an owner or admin for access."
          }
        />
        <SettingsRow
          label="3. Try your first request"
          description="Paste this into your AI client. A successful CRM tool result confirms the connection."
        >
          <div className="flex max-w-md items-start gap-2">
            <p className="min-w-0 rounded-lg bg-muted p-3 text-sm">
              {FIRST_REQUEST}
            </p>
            <CopyButton
              value={FIRST_REQUEST}
              label="Copy first request"
              successMessage="Request copied"
              variant="outline"
              size="icon-sm"
            />
          </div>
        </SettingsRow>
      </SettingsCard>
      {canManage && tokensUrl ? (
        <SettingsDisclosure
          id="personal-access-tokens"
          title="Personal access tokens"
        >
          <SettingsCard>
            <SettingsRow
              label="Bearer-token clients"
              description="Use a personal access token when your AI client does not support signing in."
            >
              <OpenLink href={tokensUrl}>Open Tokens on Every App</OpenLink>
            </SettingsRow>
          </SettingsCard>
        </SettingsDisclosure>
      ) : null}
    </SettingsSection>
  );
}

function OpenLink({ href, children }: { href: string; children: string }) {
  return (
    <Button
      variant="outline"
      nativeButton={false}
      render={<a href={href} target="_blank" rel="noreferrer" />}
    >
      {children}
      <ExternalLink data-icon="inline-end" aria-hidden />
    </Button>
  );
}
