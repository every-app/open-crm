import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/client/components/PageHeader";
import { EmptyState } from "@/client/components/EmptyState";

export const Route = createFileRoute("/_app/")({
  component: HomePage,
});

function HomePage() {
  return (
    <div className="space-y-6 px-4 py-4 md:px-6 md:py-6">
      <PageHeader title="Home" />
      <EmptyState title="Your pipeline will show here" />
    </div>
  );
}
