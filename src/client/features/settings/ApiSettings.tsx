import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
} from "@/client/components/SettingsSection";
import { CopyButton } from "@/client/components/CopyButton";
import { everyAppAccountQueryOptions } from "@/client/components/Sidebar";
import { Button } from "@/client/components/ui/button";
import { useCanManageWorkspace } from "@/client/features/settings/settingsQueries";

/**
 * Settings → API Keys: for owners and admins, where personal access tokens
 * are made (Tokens on the Every App gateway, which only they can open); for
 * everyone, the MCP endpoint agents connect to: the gateway's, which takes
 * OAuth or a token, or this app's own when the gateway's address isn't
 * known. The CRM keeps no keys of its own.
 */
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
    <SettingsPage title="API Keys">
      <SettingsCard>
        {canManage ? (
          <SettingsRow label="Personal access tokens">
            {tokensUrl ? (
              <OpenLink href={tokensUrl}>Open Tokens on Every App</OpenLink>
            ) : null}
          </SettingsRow>
        ) : null}
        <SettingsRow label="MCP endpoint">
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
      </SettingsCard>
    </SettingsPage>
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
