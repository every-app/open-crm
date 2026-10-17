import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ConnectionsSettings } from "@/client/features/mailbox/ConnectionsSettings";
import { SlackCard } from "@/client/features/slack/SlackCard";
import { connectionsSearchSchema } from "@/types/schemas/mailbox";

// Settings → Connections: each member's own mailbox and calendar, then the
// workspace's Slack. A provider's callback lands here with its outcome
// (`?provider=&connected=` or `?error=` for a mailbox, `?slack=` for Slack).
export const Route = createFileRoute("/_app/settings/connections")({
  validateSearch: connectionsSearchSchema.extend({
    slack: z.string().max(40).optional(),
  }),
  component: ConnectionsPage,
});

function ConnectionsPage() {
  const { slack, ...mailbox } = Route.useSearch();
  return (
    <div className="space-y-10">
      <ConnectionsSettings {...mailbox} />
      <SlackCard outcome={slack} />
    </div>
  );
}
