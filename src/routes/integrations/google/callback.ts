import { createFileRoute } from "@tanstack/react-router";
import { handleConnectCallback } from "@/server/features/mailbox/callback";

export const Route = createFileRoute("/integrations/google/callback")({
  server: {
    handlers: {
      GET: ({ request }: { request: Request }) =>
        handleConnectCallback(request, "google"),
    },
  },
});
