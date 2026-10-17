import { createFileRoute } from "@tanstack/react-router";
import { ConnectionsSettings } from "@/client/features/mailbox/ConnectionsSettings";
import { connectionsSearchSchema } from "@/types/schemas/mailbox";

export const Route = createFileRoute("/_app/settings/connections")({
  validateSearch: connectionsSearchSchema,
  component: ConnectionsPage,
});

function ConnectionsPage() {
  const search = Route.useSearch();
  return <ConnectionsSettings {...search} />;
}
