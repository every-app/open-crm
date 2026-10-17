import { WorkspaceRepository } from "@/server/features/workspace/repositories/WorkspaceRepository";

// The workspace's own settings beyond its name and website: how long
// archived records are kept. Owners and admins change it; everyone sees it.

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

export const SettingsService = {
  getArchiveRetention,
  setArchiveRetention,
};
