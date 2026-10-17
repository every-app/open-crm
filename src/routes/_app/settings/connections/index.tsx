import { createFileRoute } from "@tanstack/react-router";
import { ConnectionsOverview } from "@/client/features/settings/ConnectionsOverview";

export const Route = createFileRoute("/_app/settings/connections/")({
  component: ConnectionsOverview,
});
