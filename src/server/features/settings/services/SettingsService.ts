import { WorkspaceRepository } from "@/server/features/workspace/repositories/WorkspaceRepository";

// The workspace's own settings beyond its name and website: how long
// archived records are kept, and whether the research agent researches on
// its own. Owners and admins change them; everyone sees them.

async function getArchiveRetention(
  organizationId: string,
): Promise<{ days: number }> {
  const row = await WorkspaceRepository.getOrCreate(organizationId);
  return { days: row.archiveRetentionDays };
}

/** How many days an archived record is kept before it is purged for good. */
async function setArchiveRetention(
  organizationId: string,
  days: number,
): Promise<{ days: number }> {
  await WorkspaceRepository.update(organizationId, {
    archiveRetentionDays: days,
  });
  console.log("[settings] archive retention changed", {
    organizationId,
    days,
  });
  return getArchiveRetention(organizationId);
}

async function getAutomaticResearch(
  organizationId: string,
): Promise<{ enabled: boolean }> {
  const row = await WorkspaceRepository.getOrCreate(organizationId);
  return { enabled: row.researchAutomatically };
}

/**
 * Whether the agent researches on its own: new records, and the enrichment
 * sweep's backfills. Off, only what a person asks for runs, and what was
 * queued on its own waits.
 */
async function setAutomaticResearch(
  organizationId: string,
  enabled: boolean,
): Promise<{ enabled: boolean }> {
  await WorkspaceRepository.update(organizationId, {
    researchAutomatically: enabled,
  });
  console.log("[settings] automatic research changed", {
    organizationId,
    enabled,
  });
  return getAutomaticResearch(organizationId);
}

export const SettingsService = {
  getArchiveRetention,
  setArchiveRetention,
  getAutomaticResearch,
  setAutomaticResearch,
};
