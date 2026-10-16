import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/client/components/PageHeader";
import { EmptyState } from "@/client/components/EmptyState";

export const Route = createFileRoute("/_app/companies")({
  component: Page,
});

function Page() {
  return (
    <div className="space-y-6 px-4 py-4 md:px-6 md:py-6">
      <PageHeader title="Companies" />
      <EmptyState title="Coming in this port" />
    </div>
  );
}
