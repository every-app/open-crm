import { WorkspaceRepository } from "@/server/features/workspace/repositories/WorkspaceRepository";
import { AppError } from "@/server/lib/errors";
import { normalizeDomain } from "@/shared/domain";
import type { UpdateWorkspaceInput } from "@/types/schemas/workspace";

type Workspace = {
  name: string;
  website: string | null;
  onboarded: boolean;
};

async function getWorkspace(organizationId: string): Promise<Workspace> {
  const row = await WorkspaceRepository.getOrCreate(organizationId);
  return {
    name: row.name,
    website: row.website,
    onboarded: Boolean(row.onboardedAt),
  };
}

/**
 * Names the workspace and says what its website is. The first save finishes
 * onboarding.
 */
async function updateWorkspace(
  organizationId: string,
  input: UpdateWorkspaceInput,
): Promise<Workspace> {
  const website = input.website ? normalizeDomain(input.website) : null;
  if (input.website && !website) {
    throw new AppError(
      "VALIDATION_ERROR",
      "That is not a website. Enter the domain, like acme.com.",
    );
  }
  const before = await WorkspaceRepository.getOrCreate(organizationId);
  await WorkspaceRepository.update(organizationId, {
    name: input.name,
    website,
    onboardedAt: before.onboardedAt ?? new Date().toISOString(),
  });
  return getWorkspace(organizationId);
}

export const WorkspaceService = {
  getWorkspace,
  updateWorkspace,
};
