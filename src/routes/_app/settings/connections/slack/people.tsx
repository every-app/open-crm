import { createFileRoute } from "@tanstack/react-router";
import { SlackPeoplePage } from "@/client/features/slack/SlackPeoplePage";

// Where Slack's callback lands after a connect: the people review.
export const Route = createFileRoute("/_app/settings/connections/slack/people")(
  { component: SlackPeoplePage },
);
