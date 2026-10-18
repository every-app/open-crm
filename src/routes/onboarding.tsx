import { Navigate, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/client/components/ui/card";
import { SkeletonCard } from "@/client/components/SkeletonPresets";
import { QueryError } from "@/client/components/QueryState";
import { WorkspaceForm } from "@/client/features/workspace/WorkspaceForm";
import { workspaceQueryOptions } from "@/client/features/workspace/workspaceQueries";
import { hasOrgPermission } from "@/shared/org-permissions";
import { pageHead } from "@/client/lib/page-title";

export const Route = createFileRoute("/onboarding")({
  head: () => pageHead("Set up"),
  component: OnboardingPage,
});

// The first owner or admin to open the CRM names the workspace and says what
// its website is, so the agent can learn the business before it researches
// anyone. Everyone else waits for them.
function OnboardingPage() {
  const navigate = useNavigate();
  const workspaceQuery = useQuery(workspaceQueryOptions());
  const workspace = workspaceQuery.data;

  if (workspace?.onboarded) return <Navigate to="/" replace />;

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-xl">Tell us about your company</CardTitle>
        </CardHeader>
        <CardContent>
          {workspace ? (
            hasOrgPermission(workspace.role, { workspace: ["manage"] }) ? (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Two things, once. The name is what the CRM calls you; the
                  website is how the agent learns what you sell.
                </p>
                <WorkspaceForm
                  initial={{ name: "", website: null }}
                  submitLabel="Continue"
                  onSaved={() => void navigate({ to: "/" })}
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                An owner or an admin of your organization sets up the CRM the
                first time it opens. Ask one of them to open it, then come back.
              </p>
            )
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
