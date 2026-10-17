import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Bot, MessageSquare, Plus } from "lucide-react";
import { EmptyState } from "@/client/components/EmptyState";
import { PageHeader, SectionHeader } from "@/client/components/PageHeader";
import { QueryState } from "@/client/components/QueryState";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  LocalDateTime,
  RelativeTime,
} from "@/client/features/records/LocalDateTime";
import {
  builderChatsQueryOptions,
  teamAgentsQueryOptions,
} from "./teamAgentQueries";
import { STATUS_COPY } from "./teamAgentCopy";

/**
 * Agents: the team's durable automations, the person's private drafts, and
 * their builder chats (the CRM's team agents index and builder sidebar).
 */
export function AgentsPage() {
  const agents = useQuery(teamAgentsQueryOptions());
  const chats = useQuery(builderChatsQueryOptions());

  return (
    <div className="h-full overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-4xl space-y-8">
        <PageHeader
          title="Agents"
          description="Durable automations created from private agent-builder chats."
          actions={
            <Button nativeButton={false} render={<Link to="/agents/new" />}>
              <Plus data-icon="inline-start" />
              New agent
            </Button>
          }
        />

        <section className="space-y-3">
          <SectionHeader title="Team agents" />
          <QueryState
            query={agents}
            errorFallback="The agents could not be loaded."
          >
            {(rows) =>
              rows.length === 0 ? (
                <EmptyState
                  icon={Bot}
                  title="No team agents yet"
                  description="Describe one in a private chat, then review its access before deploying it."
                  action={
                    <Button
                      nativeButton={false}
                      variant="outline"
                      size="sm"
                      render={<Link to="/agents/new" />}
                    >
                      Open the builder
                    </Button>
                  }
                />
              ) : (
                <div className="overflow-hidden rounded-lg border border-border bg-card">
                  {rows.map((agent) => (
                    <Link
                      key={agent.id}
                      to="/agents/$agentId"
                      params={{ agentId: agent.id }}
                      className="flex min-h-16 items-center gap-4 border-t border-border px-4 py-3 first:border-t-0 hover:bg-muted/50"
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
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
                            Next{" "}
                            <LocalDateTime date={agent.trigger.nextRunAt} />
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
        </section>

        <section className="space-y-3">
          <SectionHeader
            title="Your builder chats"
            hint="Private to you. Deploying an agent makes it available to the whole team."
          />
          <QueryState
            query={chats}
            errorFallback="Your chats could not be loaded."
          >
            {(rows) =>
              rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No chats yet.</p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-border bg-card">
                  {rows.map((chat) => (
                    <Link
                      key={chat.id}
                      to="/agents/chat/$conversationId"
                      params={{ conversationId: chat.id }}
                      className="flex items-center gap-3 border-t border-border px-4 py-2.5 first:border-t-0 hover:bg-muted/50"
                    >
                      <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {chat.title ?? "New chat"}
                      </span>
                      {chat.unread ? (
                        <span className="size-1.5 shrink-0 rounded-full bg-primary">
                          <span className="sr-only">Unread</span>
                        </span>
                      ) : null}
                      {chat.madeAgent ? (
                        <Badge variant="outline">{chat.madeAgent.name}</Badge>
                      ) : null}
                      <span className="shrink-0 text-xs text-muted-foreground">
                        <RelativeTime date={chat.lastMessageAt} />
                      </span>
                    </Link>
                  ))}
                </div>
              )
            }
          </QueryState>
        </section>
      </div>
    </div>
  );
}
