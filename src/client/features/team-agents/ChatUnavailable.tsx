import { Link } from "@tanstack/react-router";
import { MessagesSquare } from "lucide-react";
import { EmptyState } from "@/client/components/EmptyState";
import { Button } from "@/client/components/ui/button";

/**
 * A chat that doesn't exist or isn't the person's to open (the CRM's
 * ChatUnavailable): a builder chat, or a shared chat's link.
 */
export function ChatUnavailable() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <EmptyState
        variant="plain"
        icon={MessagesSquare}
        title="Chat unavailable"
        action={
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link to="/chat" />}
          >
            Start a new chat
          </Button>
        }
      />
    </div>
  );
}
