import { createFileRoute } from "@tanstack/react-router";
import { BuilderHome } from "@/client/features/team-agents/BuilderHome";

export const Route = createFileRoute("/_app/_chat/chat/")({
  component: BuilderHome,
});
