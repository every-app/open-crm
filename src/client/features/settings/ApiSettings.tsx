import { useQuery } from "@tanstack/react-query";
import { CopyButton } from "@/client/components/CopyButton";
import { SectionHeader } from "@/client/components/PageHeader";
import { SafeExternalLink } from "@/client/components/SafeExternalLink";
import { everyAppAccountQueryOptions } from "@/client/components/Sidebar";
import { Card, CardContent } from "@/client/components/ui/card";

const LINK_CLASS =
  "inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-4";

/**
 * Settings → API: the CRM's REST API and how to call it. Tokens are made and
 * revoked on the Every App gateway; the CRM keeps no keys of its own.
 */
export function ApiSettings() {
  const { data: account } = useQuery(everyAppAccountQueryOptions());
  // The page renders in the browser (the app shell waits for the workspace),
  // where this CRM's origin is the one scripts call.
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const tokensUrl = account?.gatewayUrl
    ? `${account.gatewayUrl}/admin/tokens`
    : null;
  const openApiUrl = `${origin}/api/v1/openapi.json`;
  const example = [
    `curl ${origin}/api/v1/companies/search \\`,
    `  -H "Authorization: Bearer $EVERYAPP_TOKEN" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"q": "acme"}'`,
  ].join("\n");

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <SectionHeader title="REST API" />
        <p className="max-w-2xl text-sm text-muted-foreground">
          Scripts and other tools can read and change this CRM&apos;s companies,
          contacts, deals, activities, custom fields and saved views over HTTP.
          Each request acts as you: anything it can read or change is exactly
          what you can.
        </p>
      </section>

      <section className="space-y-3">
        <SectionHeader title="Personal access token" />
        <div className="max-w-2xl space-y-2 text-sm text-muted-foreground">
          <p>
            Tokens are made on your Every App gateway, not in the CRM.{" "}
            {tokensUrl ? (
              <SafeExternalLink
                url={tokensUrl}
                label="Open Tokens on Every App"
                className={LINK_CLASS}
              />
            ) : (
              "Open Admin → Tokens on your Every App gateway."
            )}{" "}
            Create an access token and copy it: the gateway shows it only once.
          </p>
          <p>
            Limit it to this CRM when you create it, unless your script calls
            other apps too. Revoking it on the gateway stops it at once. The
            Tokens page is for owners and admins today; if you don&apos;t see
            it, ask one of them.
          </p>
        </div>
      </section>

      <section className="max-w-2xl space-y-3">
        <SectionHeader
          title="Try it"
          action={
            <CopyButton value={example} successMessage="Command copied" />
          }
        />
        <Card>
          <CardContent>
            <pre className="overflow-x-auto font-mono text-xs leading-relaxed">
              {example}
            </pre>
          </CardContent>
        </Card>
        <p className="text-sm text-muted-foreground">
          Every endpoint, with its parameters, is in the{" "}
          <SafeExternalLink
            url={openApiUrl}
            label="OpenAPI document"
            className={LINK_CLASS}
          />
          . Errors come back with an HTTP status and a JSON body with a stable{" "}
          <code className="font-mono text-xs">code</code> and a{" "}
          <code className="font-mono text-xs">message</code>.
        </p>
      </section>
    </div>
  );
}
