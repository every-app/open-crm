import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { contact, deal } from "@/db/schema";
import type { DealStage } from "@/shared/crm-enums";

// What a company's sheet reads about the people and deals filed on it: the
// contacts and deals features own those records; the companies feature only
// lists them, compactly, and links to them.

// Deal stages in pipeline order, the open ones first. The deals feature owns
// what the stages mean; companies only count and order a company's deals.
const STAGE_ORDER = [
  "DEMO_BOOKED",
  "QUALIFIED_TO_BUY",
  "DECISION_MAKER_BOUGHT_IN",
  "CONTRACT_SENT",
  "CLOSED_WON",
  "CLOSED_LOST",
  "UNQUALIFIED_TO_BUY",
] as const satisfies readonly DealStage[];

export const OPEN_STAGES: DealStage[] = STAGE_ORDER.slice(0, 4);

/** The company's live contacts, by last name then first name. */
async function listContacts(organizationId: string, companyId: string) {
  return db
    .select({
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      title: contact.title,
      imageUrl: contact.imageUrl,
    })
    .from(contact)
    .where(
      and(
        eq(contact.organizationId, organizationId),
        eq(contact.companyId, companyId),
        isNull(contact.archivedAt),
      ),
    )
    .orderBy(
      sql`(${contact.lastName} is null)`,
      sql`lower(${contact.lastName})`,
      sql`lower(${contact.firstName})`,
      asc(contact.id),
    );
}

const stageRank = sql`case ${deal.stage} ${sql.join(
  STAGE_ORDER.map(
    (stage, rank) => sql`when ${stage} then ${sql.raw(String(rank))}`,
  ),
  sql` `,
)} end`;

/** The company's live deals, in pipeline order, soonest close first. */
async function listDeals(organizationId: string, companyId: string) {
  const rows = await db
    .select({
      id: deal.id,
      name: deal.name,
      stage: deal.stage,
      amount: deal.amount,
      currency: deal.currency,
      baseAmount: deal.baseAmount,
      expectedCloseDate: deal.expectedCloseDate,
    })
    .from(deal)
    .where(
      and(
        eq(deal.organizationId, organizationId),
        eq(deal.companyId, companyId),
        isNull(deal.archivedAt),
      ),
    )
    .orderBy(
      stageRank,
      sql`(${deal.expectedCloseDate} is null)`,
      asc(deal.expectedCloseDate),
      asc(deal.id),
    );
  return rows.map((row) => ({
    ...row,
    open: OPEN_STAGES.includes(row.stage),
  }));
}

/** One contact of the organization, with the company they work at. */
async function findContact(organizationId: string, contactId: string) {
  const [row] = await db
    .select({
      id: contact.id,
      companyId: contact.companyId,
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      phone: contact.phone,
      title: contact.title,
    })
    .from(contact)
    .where(
      and(
        eq(contact.organizationId, organizationId),
        eq(contact.id, contactId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export const CompanyRelationsRepository = {
  listContacts,
  listDeals,
  findContact,
};
