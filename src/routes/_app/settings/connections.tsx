import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { SlackCard } from "@/client/features/slack/SlackCard";

// Settings → Connections: the workspace's connected services. Slack lands
// here after an owner or admin approves it (`?slack=<outcome>`).
export const Route = createFileRoute("/_app/settings/connections")({
  validateSearch: z.object({ slack: z.string().max(40).optional() }),
  component: ConnectionsSettings,
});

function ConnectionsSettings() {
  const { slack } = Route.useSearch();
  return (
    <div className="space-y-10">
      <SlackCard outcome={slack} />
    </div>
  );
}
