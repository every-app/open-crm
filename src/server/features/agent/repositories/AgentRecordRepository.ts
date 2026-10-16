import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  type SQL,
} from "drizzle-orm";
import { chunk } from "remeda";
import { db } from "@/db";
import {
  calendarEvent,
  company,
  contact,
  contactBrief,
  deal,
  dealContact,
  emailThread,
} from "@/db/schema";
import type { EnrichmentStatus } from "@/shared/crm-enums";
import type { RecordRef } from "@/shared/records";
import { descNullsLast } from "./order";

// The agent's reads of the records it works on (the session preamble, record
// checks) and its writes to their enrichment status. Every query is scoped to
// the organization; record ids from a client or a model are never trusted on
// their own.

async function recordExists(
  organizationId: string,
  record: RecordRef,
): Promise<boolean> {
  const query =
    record.kind === "contact"
      ? db
          .select({ id: contact.id })
          .from(contact)
          .where(
            and(
              eq(contact.organizationId, organizationId),
              eq(contact.id, record.id),
            ),
          )
      : record.kind === "company"
        ? db
            .select({ id: company.id })
            .from(company)
            .where(
              and(
                eq(company.organizationId, organizationId),
                eq(company.id, record.id),
              ),
            )
        : db
            .select({ id: deal.id })
            .from(deal)
            .where(
              and(
                eq(deal.organizationId, organizationId),
                eq(deal.id, record.id),
              ),
            );
  const [row] = await query.limit(1);
  return Boolean(row);
}

async function contactForPreamble(organizationId: string, contactId: string) {
  const [row] = await db
    .select({
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      title: contact.title,
      companyId: company.id,
      companyName: company.name,
      companyDomain: company.domain,
      briefRefreshedAt: contactBrief.refreshedAt,
    })
    .from(contact)
    .leftJoin(
      company,
      and(
        eq(company.id, contact.companyId),
        eq(company.organizationId, organizationId),
      ),
    )
    .leftJoin(
      contactBrief,
      and(
        eq(contactBrief.contactId, contact.id),
        eq(contactBrief.organizationId, organizationId),
      ),
    )
    .where(
      and(
        eq(contact.organizationId, organizationId),
        eq(contact.id, contactId),
      ),
    )
    .limit(1);
  if (!row) return null;
  const [deals, [threads], [meetings]] = await Promise.all([
    db
      .select({
        role: dealContact.role,
        id: deal.id,
        name: deal.name,
        stage: deal.stage,
      })
      .from(dealContact)
      .innerJoin(deal, eq(deal.id, dealContact.dealId))
      .where(
        and(
          eq(dealContact.organizationId, organizationId),
          eq(deal.organizationId, organizationId),
          eq(dealContact.contactId, contactId),
          isNull(deal.archivedAt),
        ),
      )
      .orderBy(descNullsLast(deal.lastActivityAt))
      .limit(5),
    db
      .select({ value: count() })
      .from(emailThread)
      .where(
        and(
          eq(emailThread.organizationId, organizationId),
          eq(emailThread.contactId, contactId),
        ),
      ),
    db
      .select({ value: count() })
      .from(calendarEvent)
      .where(
        and(
          eq(calendarEvent.organizationId, organizationId),
          eq(calendarEvent.contactId, contactId),
        ),
      ),
  ]);
  return {
    ...row,
    company:
      row.companyId && row.companyName
        ? {
            id: row.companyId,
            name: row.companyName,
            domain: row.companyDomain,
          }
        : null,
    deals,
    threads: threads?.value ?? 0,
    meetings: meetings?.value ?? 0,
  };
}

async function companyForPreamble(organizationId: string, companyId: string) {
  const [row] = await db
    .select({
      name: company.name,
      domain: company.domain,
      industry: company.industry,
      description: company.description,
    })
    .from(company)
    .where(
      and(
        eq(company.organizationId, organizationId),
        eq(company.id, companyId),
      ),
    )
    .limit(1);
  if (!row) return null;
  const atCompany = and(
    eq(contact.organizationId, organizationId),
    eq(contact.companyId, companyId),
    isNull(contact.archivedAt),
  );
  const [people, [people_count], deals] = await Promise.all([
    db
      .select({
        id: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        title: contact.title,
      })
      .from(contact)
      .where(atCompany)
      .orderBy(descNullsLast(contact.lastActivityAt), asc(contact.createdAt))
      .limit(12),
    db.select({ value: count() }).from(contact).where(atCompany),
    db
      .select({ id: deal.id, name: deal.name, stage: deal.stage })
      .from(deal)
      .where(
        and(
          eq(deal.organizationId, organizationId),
          eq(deal.companyId, companyId),
          isNull(deal.archivedAt),
        ),
      )
      .orderBy(descNullsLast(deal.lastActivityAt), desc(deal.createdAt))
      .limit(8),
  ]);
  return { ...row, people, peopleCount: people_count?.value ?? 0, deals };
}

async function dealForPreamble(organizationId: string, dealId: string) {
  const [row] = await db
    .select({
      name: deal.name,
      description: deal.description,
      stage: deal.stage,
      amount: deal.amount,
      currency: deal.currency,
      expectedCloseDate: deal.expectedCloseDate,
      lastActivityAt: deal.lastActivityAt,
      companyId: company.id,
      companyName: company.name,
    })
    .from(deal)
    .leftJoin(
      company,
      and(
        eq(company.id, deal.companyId),
        eq(company.organizationId, organizationId),
      ),
    )
    .where(and(eq(deal.organizationId, organizationId), eq(deal.id, dealId)))
    .limit(1);
  if (!row) return null;
  const people = await db
    .select({
      role: dealContact.role,
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      title: contact.title,
    })
    .from(dealContact)
    .innerJoin(contact, eq(contact.id, dealContact.contactId))
    .where(
      and(
        eq(dealContact.organizationId, organizationId),
        eq(contact.organizationId, organizationId),
        eq(dealContact.dealId, dealId),
      ),
    );
  return {
    ...row,
    company:
      row.companyId && row.companyName
        ? { id: row.companyId, name: row.companyName }
        : null,
    people,
  };
}

/** Where a company lives on the web. */
async function companySite(organizationId: string, companyId: string) {
  const [row] = await db
    .select({
      id: company.id,
      name: company.name,
      domain: company.domain,
      website: company.website,
    })
    .from(company)
    .where(
      and(
        eq(company.organizationId, organizationId),
        eq(company.id, companyId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Which rows a status write may touch: any but COMPLETE, or the listed
 * statuses (plus PENDING rows last written before `pendingBefore`).
 */
export type StatusGuard =
  | "unlessComplete"
  | { statuses: EnrichmentStatus[]; pendingBefore?: string };

/** Writes the enrichment status of the contact and/or company it names. */
async function setEnrichmentStatus(
  organizationId: string,
  owned: { contactId: string | null; companyId: string | null },
  status: EnrichmentStatus,
  error: string | null,
  guard: StatusGuard,
): Promise<void> {
  const now = new Date().toISOString();
  const values = {
    enrichmentStatus: status,
    enrichmentError: error,
    updatedAt: now,
    ...(status === "COMPLETE" ? { enrichedAt: now } : {}),
  };
  if (owned.contactId) {
    await db
      .update(contact)
      .set(values)
      .where(
        and(
          eq(contact.organizationId, organizationId),
          eq(contact.id, owned.contactId),
          guarded(contact, guard),
        ),
      );
  }
  if (owned.companyId) {
    await db
      .update(company)
      .set(values)
      .where(
        and(
          eq(company.organizationId, organizationId),
          eq(company.id, owned.companyId),
          guarded(company, guard),
        ),
      );
  }
}

function guarded(
  table: typeof contact | typeof company,
  guard: StatusGuard,
): SQL | undefined {
  if (guard === "unlessComplete") {
    return ne(table.enrichmentStatus, "COMPLETE");
  }
  const listed = inArray(table.enrichmentStatus, guard.statuses);
  if (!guard.pendingBefore) return listed;
  return or(
    listed,
    and(
      eq(table.enrichmentStatus, "PENDING"),
      lt(table.updatedAt, guard.pendingBefore),
    ),
  );
}

/**
 * Of the given contacts and companies, those whose enrichment completed, with
 * when: the stale-task sweep closes a task whose record finished without it.
 */
async function completedAt(
  organizationId: string,
  ids: { contactIds: string[]; companyIds: string[] },
): Promise<Map<string, string>> {
  const completed = new Map<string, string>();
  // D1 binds at most 100 parameters per statement.
  for (const part of chunk(ids.contactIds, 90)) {
    const rows = await db
      .select({ id: contact.id, enrichedAt: contact.enrichedAt })
      .from(contact)
      .where(
        and(
          eq(contact.organizationId, organizationId),
          inArray(contact.id, part),
          eq(contact.enrichmentStatus, "COMPLETE"),
          isNotNull(contact.enrichedAt),
        ),
      );
    for (const row of rows)
      if (row.enrichedAt) completed.set(row.id, row.enrichedAt);
  }
  for (const part of chunk(ids.companyIds, 90)) {
    const rows = await db
      .select({ id: company.id, enrichedAt: company.enrichedAt })
      .from(company)
      .where(
        and(
          eq(company.organizationId, organizationId),
          inArray(company.id, part),
          eq(company.enrichmentStatus, "COMPLETE"),
          isNotNull(company.enrichedAt),
        ),
      );
    for (const row of rows)
      if (row.enrichedAt) completed.set(row.id, row.enrichedAt);
  }
  return completed;
}

export const AgentRecordRepository = {
  recordExists,
  contactForPreamble,
  companyForPreamble,
  dealForPreamble,
  companySite,
  setEnrichmentStatus,
  completedAt,
};
