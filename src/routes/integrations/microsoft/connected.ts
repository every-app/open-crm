import { createFileRoute } from "@tanstack/react-router";
import { handleConnected } from "@/server/features/mailbox/connected";

export const Route = createFileRoute("/integrations/microsoft/connected")({
  server: {
    handlers: {
      GET: ({ request }: { request: Request }) =>
        handleConnected(request, "microsoft"),
    },
  },
});
