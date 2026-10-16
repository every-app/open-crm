import { useQuery } from "@tanstack/react-query";
import { CopyButton } from "@/client/components/CopyButton";
import { SectionHeader } from "@/client/components/PageHeader";
import { QueryState } from "@/client/components/QueryState";
import { Badge } from "@/client/components/ui/badge";
import { Card, CardContent } from "@/client/components/ui/card";
import { agentStatusQueryOptions } from "@/client/features/settings/settingsQueries";

const KEYS = [
  {
    status: "openRouter",
    name: "OpenRouter",
    use: "The agent's model and its web research.",
    command: "everyapp secret set OPENROUTER_API_KEY --for gateway",
  },
  {
    status: "context",
    name: "Context.dev",
    use: "Company brand data, LinkedIn profiles and website extraction.",
    command: "everyapp secret set CONTEXT_API_KEY --for gateway",
  },
] as const;

/**
 * Settings → Agent: whether the gateway holds the keys the agent works
 * with. There is nothing to paste here: the Every App gateway holds every
 * key, and an admin sets each once there.
 */
export function AgentStatus() {
  const query = useQuery(agentStatusQueryOptions());

  return (
    <section className="space-y-3">
      <SectionHeader title="Agent" />
      <p className="max-w-2xl text-sm text-muted-foreground">
        The research agent reaches its model and company data through your Every
        App gateway, which holds their keys.
      </p>
      <QueryState
        query={query}
        errorFallback="The agent's status could not be loaded."
      >
        {(status) => (
          <Card className="max-w-2xl">
            <CardContent className="divide-y divide-border">
              {KEYS.map((key) => {
                const ready = status[key.status];
                return (
                  <div
                    key={key.status}
                    className="space-y-2 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{key.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {key.use}
                        </p>
                      </div>
                      {ready ? (
                        <Badge variant="success">Ready</Badge>
                      ) : (
                        <Badge variant="warning">Not set up</Badge>
                      )}
                    </div>
                    {ready ? null : (
                      <div className="space-y-1.5">
                        <p className="text-xs text-muted-foreground">
                          An admin sets it once on the gateway:
                        </p>
                        <div className="flex items-center gap-2">
                          <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1 font-mono text-xs">
                            {key.command}
                          </code>
                          <CopyButton
                            value={key.command}
                            successMessage="Command copied"
                            label={`Copy the command that sets ${key.name}'s key`}
                            size="icon-xs"
                            variant="ghost"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </QueryState>
    </section>
  );
}
