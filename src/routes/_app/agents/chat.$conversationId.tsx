import { createFileRoute } from "@tanstack/react-router";
import { BuilderChatPage } from "@/client/features/team-agents/BuilderChatPage";

export const Route = createFileRoute("/_app/agents/chat/$conversationId")({
  component: BuilderChatRoute,
});

function BuilderChatRoute() {
  const { conversationId } = Route.useParams();
  return <BuilderChatPage conversationId={conversationId} />;
}
