import { Navigate, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/client/components/ui/card";
import { SkeletonCard } from "@/client/components/SkeletonPresets";
import { QueryError } from "@/client/components/QueryState";
import { needsOnboarding } from "@/client/features/workspace/onboarding";
import { WorkspaceForm } from "@/client/features/workspace/WorkspaceForm";
import { workspaceQueryOptions } from "@/client/features/workspace/workspaceQueries";
import { pageHead } from "@/client/lib/page-title";

export const Route = createFileRoute("/onboarding")({
  head: () => pageHead("Set up"),
  component: OnboardingPage,
});

// The first owner or admin to open the CRM names the workspace. Its business
// website can be added now or later. Anyone with nothing to
// answer here (a member, or anyone once it's done) goes on into the CRM.
function OnboardingPage() {
  const navigate = useNavigate();
  const workspaceQuery = useQuery(workspaceQueryOptions());
  const workspace = workspaceQuery.data;

  if (workspace && !needsOnboarding(workspace)) {
    return <Navigate to="/contacts" replace />;
  }

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-xl">Name your workspace</CardTitle>
          <CardDescription>
            Your company's name. Change it any time in Settings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {workspace ? (
            <WorkspaceForm
              initial={{ name: "", website: null }}
              submitLabel="Continue"
              onSaved={() => void navigate({ to: "/contacts" })}
            />
          ) : workspaceQuery.isError ? (
            <QueryError
              error={workspaceQuery.error}
              fallback="The workspace could not be loaded."
              onRetry={() => void workspaceQuery.refetch()}
              isRetrying={workspaceQuery.isFetching}
            />
          ) : (
            <SkeletonCard />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
