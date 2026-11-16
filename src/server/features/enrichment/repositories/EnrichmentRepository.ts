import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { company, contact } from "@/db/schema";
import {
  COMPANY_FACT_FIELDS,
  PERSON_FACT_FIELDS,
  type CompanyFactField,
  type CompanyFacts,
  type PersonFactField,
  type PersonFacts,
} from "../providers/facts";

// What enrichment reads and writes: the live records a member selected, with
// what there is to look them up by, and a lookup's facts written into their
// blanks. A fill is conditional SQL, not read-then-write, so a value a person
// types while a lookup is in flight is never overwritten.

const personColumns = {
  title: contact.title,
  linkedinUrl: contact.linkedinUrl,
  twitterUrl: contact.twitterUrl,
  githubUrl: contact.githubUrl,
  imageUrl: contact.imageUrl,
} satisfies Record<PersonFactField, unknown>;

const companyColumns = {
  name: company.name,
  description: company.description,
  logoUrl: company.logoUrl,
  logoDarkUrl: company.logoDarkUrl,
  iconUrl: company.iconUrl,
  iconDarkUrl: company.iconDarkUrl,
  iconTone: company.iconTone,
  brandColor: company.brandColor,
  industry: company.industry,
  subIndustry: company.subIndustry,
  city: company.city,
  stateCode: company.stateCode,
  country: company.country,
  countryCode: company.countryCode,
  phone: company.phone,
  email: company.email,
  linkedinUrl: company.linkedinUrl,
  twitterUrl: company.twitterUrl,
  githubUrl: company.githubUrl,
  pricingUrl: company.pricingUrl,
  careersUrl: company.careersUrl,
} satisfies Record<CompanyFactField, unknown>;

/** The organization's live contacts among `ids`, each with its company's name and domain. */
async function contacts(organizationId: string, ids: string[]) {
  return db
    .select({
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      ...personColumns,
      companyName: company.name,
      companyDomain: company.domain,
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
        inArray(contact.id, ids),
        isNull(contact.archivedAt),
      ),
    );
}

/** The organization's live companies among `ids`. */
async function companies(organizationId: string, ids: string[]) {
  return db
    .select({ id: company.id, domain: company.domain, ...companyColumns })
    .from(company)
    .where(
      and(
        eq(company.organizationId, organizationId),
        inArray(company.id, ids),
        isNull(company.archivedAt),
      ),
    );
}

/**
 * Writes `facts` into the contact's blanks. The fields it filled, which may
 * be none.
 */
async function fillContact(
  organizationId: string,
  id: string,
  facts: PersonFacts,
): Promise<PersonFactField[]> {
  const offered = PERSON_FACT_FIELDS.filter((field) => facts[field]);
  if (offered.length === 0) return [];
  const where = and(
    eq(contact.organizationId, organizationId),
    eq(contact.id, id),
  );
  const [before] = await db.select(personColumns).from(contact).where(where);
  if (!before) return [];
  const values: Partial<Record<PersonFactField, SQL>> = {};
  for (const field of offered) {
    values[field] = sql`coalesce(${personColumns[field]}, ${facts[field]})`;
  }
  await db
    .update(contact)
    .set({ ...values, updatedAt: new Date().toISOString() })
    .where(where);
  return offered.filter((field) => before[field] === null);
}

/**
 * Writes `facts` into the company's blanks, and its name while that is still
 * the domain it was created from. The fields it filled, which may be none.
 */
async function fillCompany(
  organizationId: string,
  id: string,
  facts: CompanyFacts,
): Promise<CompanyFactField[]> {
  const offered = COMPANY_FACT_FIELDS.filter((field) => facts[field]);
  if (offered.length === 0) return [];
  const where = and(
    eq(company.organizationId, organizationId),
    eq(company.id, id),
  );
  const [before] = await db
    .select({ ...companyColumns, domain: company.domain })
    .from(company)
    .where(where);
  if (!before) return [];
  const values: Partial<Record<CompanyFactField, SQL>> = {};
  for (const field of offered) {
    values[field] =
      field === "name"
        ? sql`case when ${company.name} = ${company.domain} then ${facts.name} else ${company.name} end`
        : sql`coalesce(${companyColumns[field]}, ${facts[field]})`;
  }
  await db
    .update(company)
    .set({ ...values, updatedAt: new Date().toISOString() })
    .where(where);
  return offered.filter((field) =>
    field === "name"
      ? before.name === before.domain && facts.name !== before.name
      : before[field] === null,
  );
}

export const EnrichmentRepository = {
  contacts,
  companies,
  fillContact,
  fillCompany,
};
