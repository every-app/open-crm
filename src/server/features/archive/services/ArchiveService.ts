import {
  ArchiveRepository,
  type ActivityTargets,
  type ArchivedKind,
} from "@/server/features/archive/repositories/ArchiveRepository";
import { WorkspaceRepository } from "@/server/features/workspace/repositories/WorkspaceRepository";
import { MIN_ARCHIVE_RETENTION_DAYS } from "@/types/schemas/settings";

// Archived records are hidden from lists, then purged for good: by an owner
// or admin (Delete forever), or once they have been archived longer than the
// workspace's retention (Settings → Data, 180 days unless an owner or admin
// changes it). Both purge the same way.

const DAY_MS = 24 * 60 * 60 * 1000;

// At most this many records of each kind per organization per sweep; the
// next sweep carries on.
const PURGE_LIMIT = 500;

// Records per purge batch, so each statement stays under D1's 100 bound
// parameters (a company's batch names its ids twice).
const PURGE_CHUNK = 30;

const KINDS: ArchivedKind[] = ["company", "contact", "deal"];

type PurgeResult = {
  retentionDays: number;
  companies: number;
  contacts: number;
  deals: number;
};

/**
 * Permanently deletes the given records of `kind` that are still archived at
 * or before `archivedBefore`, with what goes with them, then restamps the
 * last activity of the records they shared activities with. The ids it
 * deleted: a record restored in the meantime stays.
 */
async function purgeArchived(
  organizationId: string,
  kind: ArchivedKind,
  ids: string[],
  archivedBefore: string,
): Promise<string[]> {
  const deleted: string[] = [];
  for (let start = 0; start < ids.length; start += PURGE_CHUNK) {
    const chunk = ids.slice(start, start + PURGE_CHUNK);
    const targets = await ArchiveRepository.activityTargets(
      organizationId,
      kind,
      chunk,
    );
    const gone = await ArchiveRepository.purge(
      organizationId,
      kind,
      chunk,
      archivedBefore,
    );
    deleted.push(...gone);
    if (gone.length > 0) {
      await restampAfterPurge(organizationId, kind, targets);
    }
  }
  return deleted;
}

/**
 * Permanently deletes the organization's companies, contacts and deals
 * archived longer than its retention, with what goes with them.
 */
async function purgeExpiredArchives(
  organizationId: string,
): Promise<PurgeResult> {
  const { archiveRetentionDays: retentionDays } =
    await WorkspaceRepository.getOrCreate(organizationId);
  const before = new Date(Date.now() - retentionDays * DAY_MS).toISOString();
  const purged: Record<ArchivedKind, number> = {
    company: 0,
    contact: 0,
    deal: 0,
  };
  for (const kind of KINDS) {
    const ids = await ArchiveRepository.expiredIds(
      organizationId,
      kind,
      before,
      PURGE_LIMIT,
    );
    purged[kind] = (
      await purgeArchived(organizationId, kind, ids, before)
    ).length;
  }
  const result = {
    retentionDays,
    companies: purged.company,
    contacts: purged.contact,
    deals: purged.deal,
  };
  if (result.companies + result.contacts + result.deals > 0) {
    console.log("[archive] archived records purged", {
      organizationId,
      ...result,
    });
  }
  return result;
}

// The purge is done: a failed restamp leaves a stale "last activity" time,
// not a broken purge, so it is logged rather than thrown.
async function restampAfterPurge(
  organizationId: string,
  kind: ArchivedKind,
  targets: ActivityTargets,
) {
  try {
    await ArchiveRepository.restamp(organizationId, targets);
  } catch (error) {
    console.error(
      "[archive] records were purged but their neighbours' last activity was not recomputed",
      { organizationId, kind },
      error,
    );
  }
}

/**
 * The retention sweep across organizations, for the cron: purges every
 * organization that has records archived longer than the shortest possible
 * retention. One organization failing doesn't stop the others.
 */
async function purgeAllExpiredArchives(): Promise<{
  organizations: number;
  companies: number;
  contacts: number;
  deals: number;
  failed: number;
}> {
  const candidates = await ArchiveRepository.organizationsArchivedBefore(
    new Date(Date.now() - MIN_ARCHIVE_RETENTION_DAYS * DAY_MS).toISOString(),
  );
  const totals = {
    organizations: candidates.length,
    companies: 0,
    contacts: 0,
    deals: 0,
    failed: 0,
  };
  for (const organizationId of candidates) {
    try {
      const result = await purgeExpiredArchives(organizationId);
      totals.companies += result.companies;
      totals.contacts += result.contacts;
      totals.deals += result.deals;
    } catch (error) {
      totals.failed += 1;
      console.error(
        "[archive] could not purge an organization's archived records",
        { organizationId },
        error,
      );
    }
  }
  return totals;
}

export const ArchiveService = {
  purgeArchived,
  purgeExpiredArchives,
  purgeAllExpiredArchives,
};
