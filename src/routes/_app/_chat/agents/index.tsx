import { createFileRoute } from "@tanstack/react-router";
import { AgentsPage } from "@/client/features/team-agents/AgentsPage";
import { pageHead } from "@/client/lib/page-title";

export const Route = createFileRoute("/_app/_chat/agents/")({
  head: () => pageHead("Agents"),
  component: AgentsPage,
});
