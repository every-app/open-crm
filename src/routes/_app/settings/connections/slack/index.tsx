import { createFileRoute } from "@tanstack/react-router";
import { SlackPage } from "@/client/features/slack/SlackPage";
import { slackConnectSearchSchema } from "@/types/schemas/slack";
import { pageHead } from "@/client/lib/page-title";

// Slack's callback lands here when a connect didn't finish, with why.
export const Route = createFileRoute("/_app/settings/connections/slack/")({
  head: () => pageHead("Slack"),
  validateSearch: slackConnectSearchSchema,
  component: SlackConnectionPage,
});

function SlackConnectionPage() {
  return <SlackPage connectError={Route.useSearch().error} />;
}
