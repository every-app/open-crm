import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Bot } from "lucide-react";
import { EmptyState } from "@/client/components/EmptyState";
import { PageHeader } from "@/client/components/PageHeader";
import { QueryState } from "@/client/components/QueryState";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { LocalDateTime } from "@/client/features/records/LocalDateTime";
import { teamAgentsQueryOptions } from "./teamAgentQueries";
import { STATUS_COPY } from "./teamAgentCopy";

/** The team's durable automations (the CRM's team agents index). */
export function AgentsPage() {
  const agents = useQuery(teamAgentsQueryOptions());

  return (
    <div className="px-4 pt-6 pb-24 md:px-8 md:pt-8 md:pb-12">
      <div className="mx-auto max-w-5xl space-y-6">
        <PageHeader
          title="Team agents"
          description="Durable automations created from private agent-builder chats."
        />
        <QueryState
          query={agents}
          errorFallback="The agents could not be loaded."
        >
          {(rows) =>
            rows.length === 0 ? (
              <EmptyState
                icon={Bot}
                media="rows"
                variant="card"
                size="lg"
                title="No team agents yet"
                description="Create one from a private chat, then review its access before deploying it."
                action={
                  <Button
                    nativeButton={false}
                    variant="outline"
                    render={<Link to="/chat" />}
                  >
                    Open chat
                  </Button>
                }
              />
            ) : (
              <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
                {rows.map((agent) => (
                  <Link
                    key={agent.id}
                    to="/agents/$agentId"
                    params={{ agentId: agent.id }}
                    className="flex min-h-16 items-center gap-4 border-t border-border px-5 py-3 outline-none first:border-t-0 hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.03]"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground/5 text-muted-foreground">
                      <Bot className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {agent.name}
                        </span>
                        <Badge variant={STATUS_COPY[agent.status].tone}>
                          {STATUS_COPY[agent.status].label}
                        </Badge>
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {agent.description ?? "No description"}
                      </span>
                    </span>
                    <span className="hidden shrink-0 text-right text-xs text-muted-foreground sm:block">
                      {agent.trigger?.nextRunAt ? (
                        <>
                          Next <LocalDateTime date={agent.trigger.nextRunAt} />
                        </>
                      ) : (
                        (agent.trigger?.name ?? "Manual only")
                      )}
                      <span className="block font-mono">
                        {agent.runCount} runs
                      </span>
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                ))}
              </div>
            )
          }
        </QueryState>
      </div>
    </div>
  );
}
