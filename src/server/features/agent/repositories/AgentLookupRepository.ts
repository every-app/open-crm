import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { chunk } from "remeda";
import { db } from "@/db";
import { company, contact, contactBrief, deal, user } from "@/db/schema";
import type { DealStage } from "@/shared/crm-enums";
import { LOSING_DEAL_STAGES, OPEN_DEAL_STAGES } from "@/shared/deal-stages";
import { ascNullsFirst, descNullsLast } from "./order";

// The agent's free lookups across the CRM: find a record the way a person
// would search for it, sweep the pipeline, and list contacts with research
// outstanding. Ported from the CRM's lib/lookup.ts and lib/crm.ts. Archived
// records stay out; every query is scoped to the organization.

/** Case-insensitive "contains", the same on both dialects. */
function contains(column: SQLiteColumn, term: string): SQL {
  return sql`lower(${column}) like ${`%${term.toLowerCase()}%`}`;
}

async function searchContacts(
  organizationId: string,
  input: { term: string; words: string[]; email: string | null; take: number },
) {
  return db
    .select({
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      title: contact.title,
      email: contact.email,
      lastActivityAt: contact.lastActivityAt,
      companyId: company.id,
      companyName: company.name,
    })
    .from(contact)
    .leftJoin(
      company,
      and(
        eq(company.id, contact.companyId),
        eq(company.organizationId, organizationId),
      ),
    )
    .where(
      and(
        eq(contact.organizationId, organizationId),
        isNull(contact.archivedAt),
        or(
          input.email ? eq(contact.email, input.email) : undefined,
          ...input.words.flatMap((word) => [
            contains(contact.firstName, word),
            contains(contact.lastName, word),
            contains(contact.email, word),
          ]),
          contains(company.name, input.term),
        ),
      ),
    )
    .orderBy(descNullsLast(contact.lastActivityAt), asc(contact.createdAt))
    .limit(input.take);
}

async function searchCompanies(
  organizationId: string,
  input: { term: string; words: string[]; domain: string | null; take: number },
) {
  const rows = await db
    .select({
      id: company.id,
      name: company.name,
      domain: company.domain,
      industry: company.industry,
    })
    .from(company)
    .where(
      and(
        eq(company.organizationId, organizationId),
        isNull(company.archivedAt),
        or(
          contains(company.name, input.term),
          input.domain ? contains(company.domain, input.domain) : undefined,
          ...input.words.map((word) => contains(company.name, word)),
        ),
      ),
    )
    .orderBy(descNullsLast(company.lastActivityAt), asc(company.name))
    .limit(input.take);
  const counts = await recordCounts(
    organizationId,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    ...row,
    contacts: counts.contacts.get(row.id) ?? 0,
    deals: counts.deals.get(row.id) ?? 0,
  }));
}

/** How many live contacts and deals each company has. */
async function recordCounts(organizationId: string, companyIds: string[]) {
  const contacts = new Map<string, number>();
  const deals = new Map<string, number>();
  for (const part of chunk(companyIds, 90)) {
    const [contactRows, dealRows] = await Promise.all([
      db
        .select({ companyId: contact.companyId, value: count() })
        .from(contact)
        .where(
          and(
            eq(contact.organizationId, organizationId),
            inArray(contact.companyId, part),
            isNull(contact.archivedAt),
          ),
        )
        .groupBy(contact.companyId),
      db
        .select({ companyId: deal.companyId, value: count() })
        .from(deal)
        .where(
          and(
            eq(deal.organizationId, organizationId),
            inArray(deal.companyId, part),
            isNull(deal.archivedAt),
          ),
        )
        .groupBy(deal.companyId),
    ]);
    for (const row of contactRows)
      if (row.companyId) contacts.set(row.companyId, row.value);
    for (const row of dealRows) deals.set(row.companyId, row.value);
  }
  return { contacts, deals };
}

async function searchDeals(
  organizationId: string,
  input: { term: string; words: string[]; take: number },
) {
  return db
    .select({
      id: deal.id,
      name: deal.name,
      stage: deal.stage,
      amount: deal.amount,
      currency: deal.currency,
      companyId: company.id,
      companyName: company.name,
    })
    .from(deal)
    .innerJoin(
      company,
      and(
        eq(company.id, deal.companyId),
        eq(company.organizationId, organizationId),
      ),
    )
    .where(
      and(
        eq(deal.organizationId, organizationId),
        isNull(deal.archivedAt),
        or(
          contains(deal.name, input.term),
          ...input.words.map((word) => contains(deal.name, word)),
          contains(company.name, input.term),
        ),
      ),
    )
    .orderBy(descNullsLast(deal.lastActivityAt), desc(deal.createdAt))
    .limit(input.take);
}

type DealListInput = {
  status: "open" | "won" | "lost" | "all";
  inactiveForDays?: number;
  companyId?: string;
  ownerId?: string;
  limit: number;
  offset: number;
};

/** Deals by pipeline status and inactivity, the least recently touched first. */
async function listDeals(
  organizationId: string,
  input: DealListInput,
  now: Date,
) {
  const stages =
    input.status === "open"
      ? OPEN_DEAL_STAGES
      : input.status === "won"
        ? (["CLOSED_WON"] satisfies DealStage[])
        : input.status === "lost"
          ? LOSING_DEAL_STAGES
          : null;
  const cutoff =
    input.inactiveForDays === undefined
      ? null
      : new Date(
          now.getTime() - input.inactiveForDays * 86_400_000,
        ).toISOString();
  return db
    .select({
      id: deal.id,
      name: deal.name,
      stage: deal.stage,
      amount: deal.amount,
      currency: deal.currency,
      createdAt: deal.createdAt,
      lastActivityAt: deal.lastActivityAt,
      expectedCloseDate: deal.expectedCloseDate,
      companyId: company.id,
      companyName: company.name,
      ownerId: user.id,
      ownerName: user.name,
      ownerEmail: user.email,
    })
    .from(deal)
    .innerJoin(
      company,
      and(
        eq(company.id, deal.companyId),
        eq(company.organizationId, organizationId),
      ),
    )
    .leftJoin(user, eq(user.id, deal.ownerId))
    .where(
      and(
        eq(deal.organizationId, organizationId),
        isNull(deal.archivedAt),
        stages ? inArray(deal.stage, stages) : undefined,
        input.companyId ? eq(deal.companyId, input.companyId) : undefined,
        input.ownerId ? eq(deal.ownerId, input.ownerId) : undefined,
        cutoff
          ? or(
              lte(deal.lastActivityAt, cutoff),
              and(isNull(deal.lastActivityAt), lte(deal.createdAt, cutoff)),
            )
          : undefined,
      ),
    )
    .orderBy(
      ascNullsFirst(deal.lastActivityAt),
      asc(deal.createdAt),
      asc(deal.id),
    )
    .limit(input.limit + 1)
    .offset(input.offset);
}

/**
 * Contacts with research outstanding: no real name yet, no background
 * written, or socials never looked for. Oldest first.
 */
async function contactsNeedingWork(organizationId: string, limit: number) {
  return db
    .select({
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      title: contact.title,
      linkedinUrl: contact.linkedinUrl,
      socialsCheckedAt: contact.socialsCheckedAt,
      companyName: company.name,
      companyDomain: company.domain,
      briefContactId: contactBrief.contactId,
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
        isNull(contact.archivedAt),
        or(
          isNull(contactBrief.contactId),
          isNull(contact.socialsCheckedAt),
          and(isNotNull(contact.email), isNull(contact.lastName)),
        ),
      ),
    )
    .orderBy(asc(contact.createdAt))
    .limit(limit);
}

export const AgentLookupRepository = {
  searchContacts,
  searchCompanies,
  searchDeals,
  listDeals,
  contactsNeedingWork,
};
