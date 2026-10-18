import { createFileRoute } from "@tanstack/react-router";
import { ConnectionsOverview } from "@/client/features/settings/ConnectionsOverview";
import { pageHead } from "@/client/lib/page-title";

export const Route = createFileRoute("/_app/settings/connections/")({
  head: () => pageHead("Connections"),
  component: ConnectionsOverview,
});
