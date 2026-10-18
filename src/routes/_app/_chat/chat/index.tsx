import { createFileRoute } from "@tanstack/react-router";
import { BuilderHome } from "@/client/features/team-agents/BuilderHome";
import { pageHead } from "@/client/lib/page-title";

export const Route = createFileRoute("/_app/_chat/chat/")({
  head: () => pageHead("Chat"),
  component: BuilderHome,
});
