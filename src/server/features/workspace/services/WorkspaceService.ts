import { WorkspaceRepository } from "@/server/features/workspace/repositories/WorkspaceRepository";
import { AppError, UserFacingError } from "@/server/lib/errors";
import { normalizeDomain } from "@/shared/domain";
import type { UpdateWorkspaceInput } from "@/types/schemas/workspace";

type Workspace = {
  name: string;
  website: string | null;
  onboarded: boolean;
  /** Deals are opt-in: the Deals page, sections and tools show while on. */
  dealsEnabled: boolean;
};

async function getWorkspace(organizationId: string): Promise<Workspace> {
  const row = await WorkspaceRepository.getOrCreate(organizationId);
  return {
    name: row.name,
    website: row.website,
    onboarded: Boolean(row.onboardedAt),
    dealsEnabled: row.dealsEnabled,
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

/** Turns deals on or off. Off hides them; nothing about them is deleted. */
async function setDealsEnabled(
  organizationId: string,
  enabled: boolean,
): Promise<Workspace> {
  await WorkspaceRepository.update(organizationId, { dealsEnabled: enabled });
  return getWorkspace(organizationId);
}

/** Refuses while deals are off: the deal tools say where to turn them on. */
async function requireDealsEnabled(organizationId: string): Promise<void> {
  const row = await WorkspaceRepository.getOrCreate(organizationId);
  if (!row.dealsEnabled) {
    throw new UserFacingError(
      "FORBIDDEN",
      "Deals are turned off for this workspace. An owner or admin turns them on in Settings → Workspace.",
    );
  }
}

export const WorkspaceService = {
  getWorkspace,
  updateWorkspace,
  setDealsEnabled,
  requireDealsEnabled,
};
