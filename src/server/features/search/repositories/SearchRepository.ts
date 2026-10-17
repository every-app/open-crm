import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { company, contact, deal } from "@/db/schema";
import { DEAL_STAGES } from "@/shared/crm-enums";
import { searchCondition } from "@/server/features/records/listQuery";

// The quick switcher's matches: a few live records of each kind whose name
// (or domain, or email) contains the search, case-insensitively.

/** Live companies whose name or domain contains `q`, by name. */
async function companies(organizationId: string, q: string, limit: number) {
  return db
    .select({
      id: company.id,
      name: company.name,
      domain: company.domain,
      iconUrl: company.iconUrl,
      iconDarkUrl: company.iconDarkUrl,
      iconTone: company.iconTone,
    })
    .from(company)
    .where(
      and(
        eq(company.organizationId, organizationId),
        isNull(company.archivedAt),
        searchCondition(q, [company.name, company.domain]),
      ),
    )
    .orderBy(sql`lower(${company.name})`, asc(company.id))
    .limit(limit);
}

/**
 * Live contacts whose first, last or full name or email contains `q`, by
 * last name, with the company they work at.
 */
async function contacts(organizationId: string, q: string, limit: number) {
  const fullName = sql`${contact.firstName} || ' ' || coalesce(${contact.lastName}, '')`;
  return db
    .select({
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      imageUrl: contact.imageUrl,
      companyName: company.name,
    })
    .from(contact)
    .leftJoin(
      company,
      and(
        eq(company.id, contact.companyId),
        eq(company.organizationId, contact.organizationId),
      ),
    )
    .where(
      and(
        eq(contact.organizationId, organizationId),
        isNull(contact.archivedAt),
        searchCondition(q, [
          contact.firstName,
          contact.lastName,
          contact.email,
          fullName,
        ]),
      ),
    )
    .orderBy(
      sql`(${contact.lastName} is null)`,
      sql`lower(${contact.lastName})`,
      sql`lower(${contact.firstName})`,
      asc(contact.id),
    )
    .limit(limit);
}

/** Live deals whose name contains `q`, stage by stage, with their company. */
async function deals(organizationId: string, q: string, limit: number) {
  const stageRank = sql`case ${deal.stage} ${sql.join(
    DEAL_STAGES.map(
      (stage, rank) => sql`when ${stage} then ${sql.raw(String(rank))}`,
    ),
    sql` `,
  )} end`;
  return db
    .select({
      id: deal.id,
      name: deal.name,
      companyName: company.name,
      iconUrl: company.iconUrl,
      iconDarkUrl: company.iconDarkUrl,
      iconTone: company.iconTone,
    })
    .from(deal)
    .innerJoin(
      company,
      and(
        eq(company.id, deal.companyId),
        eq(company.organizationId, deal.organizationId),
      ),
    )
    .where(
      and(
        eq(deal.organizationId, organizationId),
        isNull(deal.archivedAt),
        searchCondition(q, [deal.name]),
      ),
    )
    .orderBy(stageRank, sql`lower(${deal.name})`, asc(deal.id))
    .limit(limit);
}

export const SearchRepository = {
  companies,
  contacts,
  deals,
};
