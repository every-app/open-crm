import { createFileRoute } from "@tanstack/react-router";
import { MailboxConnectionPage } from "@/client/features/mailbox/MailboxConnectionPage";
import { mailboxConnectSearchSchema } from "@/types/schemas/mailbox";

// Microsoft's callback lands here with how the connect came back.
export const Route = createFileRoute("/_app/settings/connections/microsoft")({
  validateSearch: mailboxConnectSearchSchema,
  component: MicrosoftConnectionPage,
});

function MicrosoftConnectionPage() {
  const { connected, error } = Route.useSearch();
  return (
    <MailboxConnectionPage
      provider="microsoft"
      connected={connected}
      error={error}
    />
  );
}
