import { createFileRoute } from "@tanstack/react-router";
import { MailboxConnectionPage } from "@/client/features/mailbox/MailboxConnectionPage";
import { mailboxConnectSearchSchema } from "@/types/schemas/mailbox";
import { pageHead } from "@/client/lib/page-title";

// Google's callback lands here with how the connect came back.
export const Route = createFileRoute("/_app/settings/connections/google")({
  head: () => pageHead("Google Workspace"),
  validateSearch: mailboxConnectSearchSchema,
  component: GoogleConnectionPage,
});

function GoogleConnectionPage() {
  const { connected, error } = Route.useSearch();
  return (
    <MailboxConnectionPage
      provider="google"
      connected={connected}
      error={error}
    />
  );
}
