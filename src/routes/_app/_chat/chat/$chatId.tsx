import { createFileRoute } from "@tanstack/react-router";
import { BuilderChatPage } from "@/client/features/team-agents/BuilderChatPage";
import { pageHead } from "@/client/lib/page-title";

export const Route = createFileRoute("/_app/_chat/chat/$chatId")({
  head: () => pageHead("Agent chat"),
  component: BuilderChatRoute,
});

function BuilderChatRoute() {
  const { chatId } = Route.useParams();
  return <BuilderChatPage key={chatId} conversationId={chatId} />;
}
