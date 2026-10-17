import { eq } from "drizzle-orm";
import { db } from "@/db";
import { workspace } from "@/db/schema";
import { WorkspaceRepository } from "@/server/features/workspace/repositories/WorkspaceRepository";

// What the organization's agent last saw of its model through the gateway:
// the gateway has no status route for AI providers, so the CRM learns it
// from the gateway's answers (AgentAvailabilityService). Kept on the
// workspace row, and written without touching `updated_at`: nobody edited
// the workspace.

export type ModelSighting = {
  refusedAt: string | null;
  refusal: string | null;
  answeredAt: string | null;
};

async function read(organizationId: string): Promise<ModelSighting> {
  const row = await WorkspaceRepository.getOrCreate(organizationId);
  return {
    refusedAt: row.modelRefusedAt,
    refusal: row.modelRefusal,
    answeredAt: row.modelAnsweredAt,
  };
}

/** The gateway refused the model for want of a key, saying `message`. */
async function noteRefusal(
  organizationId: string,
  message: string,
): Promise<void> {
  await db
    .update(workspace)
    .set({ modelRefusedAt: new Date().toISOString(), modelRefusal: message })
    .where(eq(workspace.organizationId, organizationId));
}

/** The model answered. */
async function noteAnswer(organizationId: string): Promise<void> {
  await db
    .update(workspace)
    .set({ modelAnsweredAt: new Date().toISOString() })
    .where(eq(workspace.organizationId, organizationId));
}

export const AgentAvailabilityRepository = {
  read,
  noteRefusal,
  noteAnswer,
};
