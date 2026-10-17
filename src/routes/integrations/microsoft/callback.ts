import { createFileRoute } from "@tanstack/react-router";
import { handleConnectCallback } from "@/server/features/mailbox/callback";

export const Route = createFileRoute("/integrations/microsoft/callback")({
  server: {
    handlers: {
      GET: ({ request }: { request: Request }) =>
        handleConnectCallback(request, "microsoft"),
    },
  },
});
