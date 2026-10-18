import { hasOrgPermission } from "@/shared/org-permissions";

/**
 * Whether this person names the workspace before anything else: an owner or
 * an admin, until one has. A member couldn't, so isn't asked, and uses the
 * CRM meanwhile, as in the original CRM.
 */
export function needsOnboarding(workspace: {
  onboarded: boolean;
  role: string;
}): boolean {
  return (
    !workspace.onboarded &&
    hasOrgPermission(workspace.role, { workspace: ["manage"] })
  );
}
