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

/**
 * Connect, authorize, and prove the connection with a real CRM tool result.
 * The CRM's rendering of everyapp.com/docs/connect-ai: the same clients and
 * the same Claude Code line, so what a person reads here and there agree.
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
  const claudeCodeCommand = mcpUrl
    ? `claude mcp add --transport http everyapp ${mcpUrl}`
    : null;

  return (
    <SettingsSection
      id="ai-clients"
      title="Connect your AI client"
      description="Your Every App gateway has one address for AI assistants. Connected once, an assistant works in the CRM the way you can: companies, contacts, deals, follow-ups and agents."
    >
      <SettingsCard>
        <SettingsRow
          label="1. Claude or ChatGPT"
          description="Add a custom connector and paste this address."
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
          stacked
          label="2. Claude Code"
          description="Run this in a terminal, then type /mcp, choose everyapp and Authenticate."
        >
          {claudeCodeCommand ? (
            <div className="flex max-w-full items-center gap-2">
              <code className="min-w-0 truncate rounded-md bg-muted px-2 py-1 font-mono text-xs">
                {claudeCodeCommand}
              </code>
              <CopyButton
                value={claudeCodeCommand}
                successMessage="Command copied"
                label="Copy the Claude Code command"
                size="icon-xs"
                variant="ghost"
              />
            </div>
          ) : null}
        </SettingsRow>
        <SettingsRow
          label="3. Sign in"
          description={
            account?.gatewayUrl
              ? "Your Every App sign-in page opens: sign in, allow the CRM, and choose whether the assistant may change things or only read."
              : "This endpoint uses bearer-token authentication. Ask an owner or admin for access."
          }
        />
        <SettingsRow
          label="4. Try your first request"
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
              description="Cursor and other tools add the same address as an MCP server. Tools that can't sign in on their own take a personal access token instead, as the Authorization: Bearer header."
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
