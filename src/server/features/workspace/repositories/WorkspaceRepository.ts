import { eq } from "drizzle-orm";
import { db } from "@/db";
import { workspace, workspaceProfile } from "@/db/schema";

// The original CRM's name for a workspace nobody has named yet, which is
// what a member sees until an owner or admin onboards it.
const DEFAULT_WORKSPACE_NAME = "CRM";

/**
 * The organization's workspace row, created on first read: every
 * organization the gateway lets in has one, named until onboarding.
 */
async function getOrCreate(organizationId: string) {
  const existing = await db.query.workspace.findFirst({
    where: eq(workspace.organizationId, organizationId),
  });
  if (existing) return existing;
  await db
    .insert(workspace)
    .values({ organizationId, name: DEFAULT_WORKSPACE_NAME })
    .onConflictDoNothing({ target: workspace.organizationId });
  const created = await db.query.workspace.findFirst({
    where: eq(workspace.organizationId, organizationId),
  });
  if (!created) throw new Error("Workspace row missing after insert");
  return created;
}

async function update(
  organizationId: string,
  patch: Partial<
    Omit<typeof workspace.$inferInsert, "organizationId" | "createdAt">
  >,
) {
  await getOrCreate(organizationId);
  await db
    .update(workspace)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(workspace.organizationId, organizationId));
}

async function getProfile(organizationId: string) {
  const row = await db.query.workspaceProfile.findFirst({
    where: eq(workspaceProfile.organizationId, organizationId),
  });
  return row ?? null;
}

export const WorkspaceRepository = {
  getOrCreate,
  update,
  getProfile,
};
