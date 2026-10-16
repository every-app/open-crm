import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { SectionHeader } from "@/client/components/PageHeader";
import { ThemePreferenceRadio } from "@/client/components/ThemePreferenceMenuItems";
import { WorkspaceForm } from "@/client/features/workspace/WorkspaceForm";
import { workspaceQueryOptions } from "@/client/features/workspace/workspaceQueries";
import { hasOrgPermission } from "@/shared/org-permissions";

export const Route = createFileRoute("/_app/settings/")({
  component: WorkspaceSettings,
});

function WorkspaceSettings() {
  const { data: workspace } = useQuery(workspaceQueryOptions());
  if (!workspace) return null;
  const canManage = hasOrgPermission(workspace.role, {
    workspace: ["manage"],
  });

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <SectionHeader
          title="Workspace"
          hint={
            canManage
              ? undefined
              : "Only an owner or an admin can change the workspace."
          }
        />
        {canManage ? (
          <WorkspaceForm
            initial={workspace}
            submitLabel="Save"
            onSaved={() => toast.success("Workspace saved")}
          />
        ) : (
          <dl className="grid max-w-md grid-cols-[8rem_1fr] gap-2 text-sm">
            <dt className="text-muted-foreground">Company name</dt>
            <dd>{workspace.name}</dd>
            <dt className="text-muted-foreground">Website</dt>
            <dd>{workspace.website ?? "—"}</dd>
          </dl>
        )}
      </section>

      <section className="space-y-3">
        <SectionHeader title="Appearance" />
        <div className="flex max-w-md items-center justify-between gap-6">
          <span className="text-sm">Theme</span>
          <ThemePreferenceRadio />
        </div>
      </section>
    </div>
  );
}
