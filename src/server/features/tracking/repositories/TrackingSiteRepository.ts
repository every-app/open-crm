import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { trackedDomain, trackingSite } from "@/db/schema";
import type { DomainScope, TrackingFlag } from "@/shared/tracking";

// An organization's tracking settings and allowed domains. The one lookup
// not by organization is by site id (findBySiteId): the public routes carry
// nothing else, and the id is unguessable and rotatable.

/** The organization's settings row, created with the defaults on first use. */
async function getOrCreate(organizationId: string) {
  const existing = await db.query.trackingSite.findFirst({
    where: eq(trackingSite.organizationId, organizationId),
  });
  if (existing) return existing;
  await db
    .insert(trackingSite)
    .values({ organizationId })
    .onConflictDoNothing({ target: trackingSite.organizationId });
  const created = await db.query.trackingSite.findFirst({
    where: eq(trackingSite.organizationId, organizationId),
  });
  if (!created) throw new Error("Tracking settings row missing after insert");
  return created;
}

/** The settings a site id names, with the organization it belongs to. */
async function findBySiteId(siteId: string) {
  const row = await db.query.trackingSite.findFirst({
    where: eq(trackingSite.siteId, siteId),
  });
  return row ?? null;
}

async function setFlag(
  organizationId: string,
  flag: TrackingFlag,
  enabled: boolean,
) {
  await getOrCreate(organizationId);
  await db
    .update(trackingSite)
    .set({ [flag]: enabled, updatedAt: new Date().toISOString() })
    .where(eq(trackingSite.organizationId, organizationId));
}

async function setCookieDays(organizationId: string, cookieDays: number) {
  await getOrCreate(organizationId);
  await db
    .update(trackingSite)
    .set({ cookieDays, updatedAt: new Date().toISOString() })
    .where(eq(trackingSite.organizationId, organizationId));
}

/** Gives the site its first id, unless a concurrent request already did. */
async function setSiteIdIfMissing(organizationId: string, siteId: string) {
  await db
    .update(trackingSite)
    .set({ siteId, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(trackingSite.organizationId, organizationId),
        isNull(trackingSite.siteId),
      ),
    );
}

async function replaceSiteId(organizationId: string, siteId: string) {
  await getOrCreate(organizationId);
  await db
    .update(trackingSite)
    .set({ siteId, updatedAt: new Date().toISOString() })
    .where(eq(trackingSite.organizationId, organizationId));
}

async function listDomains(organizationId: string) {
  return db
    .select({
      id: trackedDomain.id,
      host: trackedDomain.host,
      scope: trackedDomain.scope,
      pageViews: trackedDomain.pageViews,
      lastSeenAt: trackedDomain.lastSeenAt,
    })
    .from(trackedDomain)
    .where(eq(trackedDomain.organizationId, organizationId))
    .orderBy(asc(trackedDomain.createdAt), asc(trackedDomain.host));
}

async function countDomains(organizationId: string) {
  const [row] = await db
    .select({ value: count() })
    .from(trackedDomain)
    .where(eq(trackedDomain.organizationId, organizationId));
  return row?.value ?? 0;
}

/** Throws a unique violation when the host is already on the list. */
async function addDomain(
  organizationId: string,
  host: string,
  scope: DomainScope,
) {
  const id = crypto.randomUUID();
  await db.insert(trackedDomain).values({ id, organizationId, host, scope });
  return id;
}

/** False when the organization has no such domain. */
async function removeDomain(organizationId: string, id: string) {
  const removed = await db
    .delete(trackedDomain)
    .where(
      and(
        eq(trackedDomain.organizationId, organizationId),
        eq(trackedDomain.id, id),
      ),
    )
    .returning({ id: trackedDomain.id });
  return removed.length > 0;
}

/** Counts page views against an allowed domain and marks it seen. */
async function recordDomainViews(
  organizationId: string,
  host: string,
  views: number,
  seenAt: string,
) {
  await db
    .update(trackedDomain)
    .set({
      pageViews: sql`${trackedDomain.pageViews} + ${views}`,
      lastSeenAt: seenAt,
    })
    .where(
      and(
        eq(trackedDomain.organizationId, organizationId),
        eq(trackedDomain.host, host),
      ),
    );
}

export const TrackingSiteRepository = {
  getOrCreate,
  findBySiteId,
  setFlag,
  setCookieDays,
  setSiteIdIfMissing,
  replaceSiteId,
  listDomains,
  countDomains,
  addDomain,
  removeDomain,
  recordDomainViews,
};
