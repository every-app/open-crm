import { createFileRoute, Outlet } from "@tanstack/react-router";
import { SectionLayout } from "@/client/components/SectionLayout";
import { ChatNav } from "@/client/features/team-agents/ChatNav";

// Chat and the team agents its chats make share one column: the person's
// chats, then the team's agents.
export const Route = createFileRoute("/_app/_chat")({
  component: ChatLayout,
});

function ChatLayout() {
  return (
    <SectionLayout label="Chats and team agents" nav={<ChatNav />}>
      <Outlet />
    </SectionLayout>
  );
}
