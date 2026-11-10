import { Link } from "@tanstack/react-router";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/client/components/EmptyState";
import { Button } from "@/client/components/ui/button";

/** An address with no page behind it. */
export function NotFound() {
  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <EmptyState
        variant="plain"
        icon={SearchX}
        title="Page not found"
        description="There is nothing at this address."
        action={
          <Button nativeButton={false} render={<Link to="/contacts" />}>
            Go to Contacts
          </Button>
        }
      />
    </div>
  );
}
