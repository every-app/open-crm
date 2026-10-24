import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Bot } from "lucide-react";
import { CopyButton } from "@/client/components/CopyButton";
import { EmptyState } from "@/client/components/EmptyState";
import { PageHeader } from "@/client/components/PageHeader";
import { QueryState } from "@/client/components/QueryState";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { LocalDateTime } from "@/client/features/records/LocalDateTime";
import { teamAgentsQueryOptions } from "./teamAgentQueries";
import { STATUS_COPY } from "./teamAgentCopy";

// An ask that works on a fresh install: a SCHEDULE trigger and
// crm.activity.create, nothing that needs Slack or a mailbox connected.
const EXAMPLE_ASK =
  "Create a team agent that runs every Monday morning and writes a task on each open deal that hasn't moved in two weeks.";

/** The team's durable automations (the CRM's team agents index). */
export function AgentsPage() {
  const agents = useQuery(teamAgentsQueryOptions());

  return (
    <div className="px-4 pt-6 pb-24 md:px-8 md:pt-8 md:pb-12">
      <div className="mx-auto max-w-5xl space-y-6">
        <PageHeader
          title="Agents"
          actions={
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link to="/settings/connections" hash="ai-clients" />}
            >
              Connect your AI client
            </Button>
          }
        />
        <QueryState
          query={agents}
          errorFallback="The agents could not be loaded."
        >
          {(rows) =>
            rows.length === 0 ? (
              <EmptyState
                icon={Bot}
                media="icon"
                variant="card"
                size="lg"
                title="No agents yet"
                description={
                  <>
                    Ask your AI client to create an agent, then review and
                    deploy its draft here. Try asking:
                    <div className="mt-3 flex max-w-md items-start gap-2 text-left">
                      <p className="min-w-0 rounded-lg bg-muted p-3 text-sm text-foreground">
                        {EXAMPLE_ASK}
                      </p>
                      <CopyButton
                        value={EXAMPLE_ASK}
                        label="Copy the example"
                        successMessage="Example copied"
                        variant="outline"
                        size="icon-sm"
                      />
                    </div>
                  </>
                }
                action={
                  <Button
                    nativeButton={false}
                    variant="outline"
                    render={
                      <Link to="/settings/connections" hash="ai-clients" />
                    }
                  >
                    Connect your AI client
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
                      {agent.description ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {agent.description}
                        </span>
                      ) : null}
                    </span>
                    <span className="hidden shrink-0 text-right text-xs text-muted-foreground sm:block">
                      {agent.status === "LIVE" && agent.trigger?.nextRunAt ? (
                        <>
                          Next <LocalDateTime date={agent.trigger.nextRunAt} />
                        </>
                      ) : agent.status === "PAUSED" ? (
                        "Schedule paused"
                      ) : (
                        (agent.trigger?.name ?? "Manual only")
                      )}
                      <span className="block font-mono">
                        {agent.runCount} {agent.runCount === 1 ? "run" : "runs"}
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
