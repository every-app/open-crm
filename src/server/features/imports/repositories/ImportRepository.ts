import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { chunk } from "remeda";
import { db } from "@/db";
import { company, contact, deal } from "@/db/schema";

// The lookups a CSV import makes to find the records its rows already are:
// live companies by domain or name, live contacts by email or first name,
// live deals by name. Each takes one chunk's keys, cut below D1's bound
// parameter limit. Writes go through each record's own repository.

const KEYS_PER_STATEMENT = 90;

/** Live companies with any of `domains`. */
async function companiesByDomain(organizationId: string, domains: string[]) {
  const rows: { id: string; name: string; domain: string | null }[] = [];
  for (const part of chunk([...new Set(domains)], KEYS_PER_STATEMENT)) {
    rows.push(
      ...(await db
        .select({ id: company.id, name: company.name, domain: company.domain })
        .from(company)
        .where(
          and(
            eq(company.organizationId, organizationId),
            isNull(company.archivedAt),
            inArray(company.domain, part),
          ),
        )),
    );
  }
  return rows;
}

/** Live companies whose lowercased name is one of `names` (lowercased). */
async function companiesByName(organizationId: string, names: string[]) {
  const rows: { id: string; name: string; domain: string | null }[] = [];
  for (const part of chunk([...new Set(names)], KEYS_PER_STATEMENT)) {
    rows.push(
      ...(await db
        .select({ id: company.id, name: company.name, domain: company.domain })
        .from(company)
        .where(
          and(
            eq(company.organizationId, organizationId),
            isNull(company.archivedAt),
            inArray(sql`lower(${company.name})`, part),
          ),
        )),
    );
  }
  return rows;
}

type ContactMatch = {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  companyId: string | null;
};

const contactColumns = {
  id: contact.id,
  firstName: contact.firstName,
  lastName: contact.lastName,
  email: contact.email,
  companyId: contact.companyId,
};

/** Live contacts with any of `emails` (stored lowercased). */
async function contactsByEmail(organizationId: string, emails: string[]) {
  const rows: ContactMatch[] = [];
  for (const part of chunk([...new Set(emails)], KEYS_PER_STATEMENT)) {
    rows.push(
      ...(await db
        .select(contactColumns)
        .from(contact)
        .where(
          and(
            eq(contact.organizationId, organizationId),
            isNull(contact.archivedAt),
            inArray(contact.email, part),
          ),
        )),
    );
  }
  return rows;
}

/** Live contacts with no email whose lowercased first name is one of `names`. */
async function contactsByFirstName(organizationId: string, names: string[]) {
  const rows: ContactMatch[] = [];
  for (const part of chunk([...new Set(names)], KEYS_PER_STATEMENT)) {
    rows.push(
      ...(await db
        .select(contactColumns)
        .from(contact)
        .where(
          and(
            eq(contact.organizationId, organizationId),
            isNull(contact.archivedAt),
            isNull(contact.email),
            inArray(sql`lower(${contact.firstName})`, part),
          ),
        )),
    );
  }
  return rows;
}

/** Live deals whose lowercased name is one of `names` (lowercased). */
async function dealsByName(organizationId: string, names: string[]) {
  const rows: { id: string; name: string; companyId: string }[] = [];
  for (const part of chunk([...new Set(names)], KEYS_PER_STATEMENT)) {
    rows.push(
      ...(await db
        .select({ id: deal.id, name: deal.name, companyId: deal.companyId })
        .from(deal)
        .where(
          and(
            eq(deal.organizationId, organizationId),
            isNull(deal.archivedAt),
            inArray(sql`lower(${deal.name})`, part),
          ),
        )),
    );
  }
  return rows;
}

export const ImportRepository = {
  companiesByDomain,
  companiesByName,
  contactsByEmail,
  contactsByFirstName,
  dealsByName,
};
