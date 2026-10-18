import { createFileRoute } from "@tanstack/react-router";
import { AgentDetailPage } from "@/client/features/team-agents/AgentDetailPage";
import { pageHead } from "@/client/lib/page-title";

export const Route = createFileRoute("/_app/_chat/agents/$agentId")({
  head: () => pageHead("Team agent"),
  component: AgentDetailRoute,
});

function AgentDetailRoute() {
  const { agentId } = Route.useParams();
  return <AgentDetailPage key={agentId} agentId={agentId} />;
}
