import { createFileRoute } from "@tanstack/react-router";
import { BuilderChatPage } from "@/client/features/team-agents/BuilderChatPage";

export const Route = createFileRoute("/_app/_chat/chat/$chatId")({
  component: BuilderChatRoute,
});

function BuilderChatRoute() {
  const { chatId } = Route.useParams();
  return <BuilderChatPage key={chatId} conversationId={chatId} />;
}
