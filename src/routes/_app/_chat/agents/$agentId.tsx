import { createFileRoute } from "@tanstack/react-router";
import { AgentDetailPage } from "@/client/features/team-agents/AgentDetailPage";

export const Route = createFileRoute("/_app/_chat/agents/$agentId")({
  component: AgentDetailRoute,
});

function AgentDetailRoute() {
  const { agentId } = Route.useParams();
  return <AgentDetailPage key={agentId} agentId={agentId} />;
}
