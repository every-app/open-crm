import { and, asc, desc, eq, isNull, sql, type AnyColumn } from "drizzle-orm";
import { db } from "@/db";
import { company, contact, deal } from "@/db/schema";
import { searchCondition } from "@/server/features/records/listQuery";

// The records a person can tag in a builder chat's composer, as the CRM's
// builder resources. Every read is the organization's.

/** Most recently active first; records nothing has happened on yet last. */
function recentFirst(column: AnyColumn) {
  return [sql`${column} is null`, desc(column)];
}

/**
 * The records a person can tag in the composer, as the CRM's builder
 * resources: the organization's live companies, contacts and deals, `perKind`
 * of each, the most recently active first, and with a `term` only those
 * whose name (a contact's name or email, a company's domain) contains it.
 */
async function taggableRecords(
  organizationId: string,
  term: string,
  perKind: number,
) {
  const fullName = sql`${contact.firstName} || ' ' || coalesce(${contact.lastName}, '')`;
  const companyIcon = {
    iconUrl: company.iconUrl,
    iconDarkUrl: company.iconDarkUrl,
    iconTone: company.iconTone,
  };
  const [companies, contacts, deals] = await Promise.all([
    db
      .select({
        id: company.id,
        name: company.name,
        domain: company.domain,
        ...companyIcon,
      })
      .from(company)
      .where(
        and(
          eq(company.organizationId, organizationId),
          isNull(company.archivedAt),
          searchCondition(term, [company.name, company.domain]),
        ),
      )
      .orderBy(...recentFirst(company.lastActivityAt), asc(company.id))
      .limit(perKind),
    db
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
          searchCondition(term, [
            contact.firstName,
            contact.lastName,
            contact.email,
            fullName,
          ]),
        ),
      )
      .orderBy(...recentFirst(contact.lastActivityAt), asc(contact.id))
      .limit(perKind),
    db
      .select({
        id: deal.id,
        name: deal.name,
        companyName: company.name,
        ...companyIcon,
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
          searchCondition(term, [deal.name]),
        ),
      )
      .orderBy(...recentFirst(deal.lastActivityAt), asc(deal.id))
      .limit(perKind),
  ]);
  return { companies, contacts, deals };
}

export const BuilderResourceRepository = { taggableRecords };
