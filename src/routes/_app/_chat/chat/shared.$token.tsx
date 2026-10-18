import { createFileRoute } from "@tanstack/react-router";
import { SharedChatPage } from "@/client/features/sharing/SharedChatPage";
import { pageHead } from "@/client/lib/page-title";

export const Route = createFileRoute("/_app/_chat/chat/shared/$token")({
  head: () => pageHead("Agent chat"),
  component: SharedChatRoute,
});

function SharedChatRoute() {
  const { token } = Route.useParams();
  return <SharedChatPage key={token} token={token} />;
}
