import {
  and,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  lt,
  notExists,
  or,
} from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import { activity, company, deal, user } from "@/db/schema";
import {
  activityTargets,
  clearAgentRows,
  idChunks,
  recomputeLastActivity,
} from "@/server/features/records/recordRules";
import type { DealStage } from "@/shared/crm-enums";
import { isClosedStage } from "@/shared/deal-stages";

// Deals: the pipeline's rows. A deal belongs to one company of its
// organization and is owned by one member. Its stage moves only through
// moveStage, which files each move on the deal's timeline. The list's
// query lives in DealListRepository.

/** A deal's company, as lists and sheets show it. */
export const dealCompanyColumns = {
  id: company.id,
  name: company.name,
  domain: company.domain,
  logoUrl: company.logoUrl,
  iconUrl: company.iconUrl,
  iconDarkUrl: company.iconDarkUrl,
  iconTone: company.iconTone,
};

export const dealOwnerColumns = {
  id: user.id,
  name: user.name,
  email: user.email,
  image: user.image,
};

// The deal's company is always its organization's; the join says so too.
export const ofItsCompany = and(
  eq(company.id, deal.companyId),
  eq(company.organizationId, deal.organizationId),
);

function inOrganization(organizationId: string, id: string) {
  return and(eq(deal.organizationId, organizationId), eq(deal.id, id));
}

/** One deal of the organization, with its company and owner. */
async function findById(organizationId: string, id: string) {
  const [row] = await db
    .select({
      deal,
      company: { ...dealCompanyColumns, industry: company.industry },
      owner: dealOwnerColumns,
    })
    .from(deal)
    .innerJoin(company, ofItsCompany)
    .innerJoin(user, eq(user.id, deal.ownerId))
    .where(inOrganization(organizationId, id))
    .limit(1);
  if (!row) return null;
  return { ...row.deal, company: row.company, owner: row.owner };
}

async function insert(values: Omit<typeof deal.$inferInsert, "id">) {
  const [row] = await db
    .insert(deal)
    .values({ ...values, id: crypto.randomUUID() })
    .returning({ id: deal.id, name: deal.name, companyId: deal.companyId });
  if (!row) throw new Error("Deal row missing after insert");
  return row;
}

type DealPatch = Partial<
  Omit<typeof deal.$inferInsert, "id" | "organizationId">
>;

/** The changed deal, or null when it isn't the organization's. */
async function update(organizationId: string, id: string, patch: DealPatch) {
  const [row] = await db
    .update(deal)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(inOrganization(organizationId, id))
    .returning({ id: deal.id, name: deal.name });
  return row ?? null;
}

type StageMove = {
  id: string;
  companyId: string;
  from: DealStage;
  to: DealStage;
  /** Why it closed (or anything said about the move), for its timeline. */
  reason: string | null;
  movedById: string;
};

/**
 * Moves the deal from `from` to `to` and files the move on its timeline (a
 * STAGE_CHANGE activity), in one batch. The move lands only while the deal
 * is still in `from`, so of two people moving it at once one wins, and the
 * loser's activity is taken back out in the same batch. Moving into an
 * outcome stamps when it closed; moving out of one clears it. True when
 * this call moved the deal.
 */
async function moveStage(
  organizationId: string,
  move: StageMove,
): Promise<boolean> {
  const at = new Date().toISOString();
  const closed = isClosedStage(move.to);
  const activityId = crypto.randomUUID();
  await runBatch((tx) => {
    // The deal as this move leaves it, which every later statement needs.
    const moved = tx
      .select({ id: deal.id })
      .from(deal)
      .where(
        and(
          inOrganization(organizationId, move.id),
          eq(deal.stage, move.to),
          eq(deal.stageChangedAt, at),
        ),
      );
    return [
      tx
        .update(deal)
        .set({
          stage: move.to,
          stageChangedAt: at,
          closedAt: closed ? at : null,
          closedReason: closed ? move.reason : null,
          lastActivityAt: at,
          updatedAt: at,
        })
        .where(
          and(
            inOrganization(organizationId, move.id),
            eq(deal.stage, move.from),
          ),
        ),
      tx.insert(activity).values({
        id: activityId,
        organizationId,
        type: "STAGE_CHANGE",
        subject: "Stage changed",
        body: move.reason,
        occurredAt: at,
        companyId: move.companyId,
        dealId: move.id,
        createdById: move.movedById,
        meta: { from: move.from, to: move.to },
        createdAt: at,
        updatedAt: at,
      }),
      tx
        .delete(activity)
        .where(
          and(
            eq(activity.organizationId, organizationId),
            eq(activity.id, activityId),
            notExists(moved),
          ),
        ),
      tx
        .update(company)
        .set({ lastActivityAt: at })
        .where(
          and(
            eq(company.organizationId, organizationId),
            eq(company.id, move.companyId),
            or(isNull(company.lastActivityAt), lt(company.lastActivityAt, at)),
            exists(moved),
          ),
        ),
    ];
  });
  const [filed] = await db
    .select({ id: activity.id })
    .from(activity)
    .where(
      and(
        eq(activity.organizationId, organizationId),
        eq(activity.id, activityId),
      ),
    );
  return Boolean(filed);
}

/** Archives the live deals among `ids`; the ids it archived. */
async function archive(organizationId: string, ids: string[]) {
  const now = new Date().toISOString();
  const archived: string[] = [];
  for (const part of idChunks(ids)) {
    const rows = await db
      .update(deal)
      .set({ archivedAt: now, updatedAt: now })
      .where(
        and(
          eq(deal.organizationId, organizationId),
          inArray(deal.id, part),
          isNull(deal.archivedAt),
        ),
      )
      .returning({ id: deal.id });
    archived.push(...rows.map((row) => row.id));
  }
  return archived;
}

/** Brings an archived deal back; null when it isn't the organization's or isn't archived. */
async function restore(organizationId: string, id: string) {
  const [row] = await db
    .update(deal)
    .set({ archivedAt: null, updatedAt: new Date().toISOString() })
    .where(and(inOrganization(organizationId, id), isNotNull(deal.archivedAt)))
    .returning({ id: deal.id, name: deal.name });
  return row ?? null;
}

/**
 * Permanently deletes an archived deal. Its activities, contacts' links,
 * custom field values and conversations go with it (foreign keys); its
 * company and contacts stay. The agent's rows about it are cleared in the
 * same batch, and the records its activities were also filed on get their
 * last activity restamped. False when nothing was deleted: the deal isn't
 * the organization's, or isn't archived.
 */
async function purge(organizationId: string, id: string): Promise<boolean> {
  const isArchived = and(
    inOrganization(organizationId, id),
    isNotNull(deal.archivedAt),
  );
  const guard = exists(db.select({ id: deal.id }).from(deal).where(isArchived));
  const targets = await activityTargets(
    organizationId,
    eq(activity.dealId, id),
  );
  await runBatch((tx) => [
    ...clearAgentRows(tx, organizationId, (row) => eq(row.dealId, id), guard),
    tx.delete(deal).where(isArchived),
  ]);
  const [left] = await db
    .select({ id: deal.id })
    .from(deal)
    .where(inOrganization(organizationId, id));
  if (left) return false;
  await recomputeLastActivity(organizationId, targets);
  return true;
}

/** Gives `ids` to `ownerId`; how many it changed. */
async function setOwner(
  organizationId: string,
  ids: string[],
  ownerId: string,
) {
  let changed = 0;
  for (const part of idChunks(ids)) {
    const rows = await db
      .update(deal)
      .set({ ownerId, updatedAt: new Date().toISOString() })
      .where(
        and(eq(deal.organizationId, organizationId), inArray(deal.id, part)),
      )
      .returning({ id: deal.id });
    changed += rows.length;
  }
  return changed;
}

export const DealRepository = {
  findById,
  insert,
  update,
  moveStage,
  archive,
  restore,
  purge,
  setOwner,
};
