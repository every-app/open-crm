import { createFileRoute } from "@tanstack/react-router";
import { AgentsPage } from "@/client/features/team-agents/AgentsPage";

export const Route = createFileRoute("/_app/_chat/agents/")({
  component: AgentsPage,
});
