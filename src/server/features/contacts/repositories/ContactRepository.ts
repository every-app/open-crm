import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import { company, contact, suppressedContact, user } from "@/db/schema";
import type { RecordSource } from "@/shared/crm-enums";
import { leaveOtherCompanies } from "@/server/features/contacts/repositories/ContactRelationsRepository";
import {
  FILTER_OPTIONS_MAX,
  activityCondition,
  activityCounts,
  anyOfCondition,
  archivedCondition,
  countsByValue,
  ownerCondition,
  pageWindow,
  searchCondition,
  sortOrder,
  type SortSpec,
} from "@/server/features/records/listQuery";
import { idChunks } from "@/server/features/records/recordRules";
import {
  NO_COMPANY,
  type ContactListInput,
  type ContactSort,
} from "@/types/schemas/contacts";
import { UNASSIGNED, type FacetCounts } from "@/types/schemas/records";

// Contacts: the people in the pipeline. A live contact's email is unique in
// its organization (the partial unique index contact_organization_email_
// active_uidx; emails are stored lowercased, so it is case-insensitive). An
// archived contact keeps its email, so a restore can conflict.

const SORTS = {
  title: { by: sql`lower(${contact.title})`, nullsLast: true },
  email: { by: contact.email, nullsLast: true },
  company: { by: sql`lower(${company.name})`, nullsLast: true },
  owner: {
    by: sql`lower(${user.name})`,
    nullsLast: true,
    ties: [sql`lower(${contact.lastName})`],
  },
  lastActivity: { by: contact.lastActivityAt, nullsLast: true },
  createdAt: { by: contact.createdAt },
  archivedAt: { by: contact.archivedAt, nullsLast: true },
} satisfies Record<Exclude<ContactSort, "name">, SortSpec>;

/**
 * ORDER BY for the list. A name sorts by last name, then first name, as an
 * address book does; people known by one name only come last either way.
 */
function orderOf(input: ContactListInput): SQL[] {
  if (input.sort !== "name") {
    return sortOrder(SORTS[input.sort], input.dir, contact.id);
  }
  const direction = input.dir === "asc" ? asc : desc;
  return [
    sql`(${contact.lastName} is null)`,
    direction(sql`lower(${contact.lastName})`),
    direction(sql`lower(${contact.firstName})`),
    asc(contact.id),
  ];
}

function inOrganization(organizationId: string, id: string) {
  return and(eq(contact.organizationId, organizationId), eq(contact.id, id));
}

// The contact's company, from the same organization (a contact's company
// always is; the join says so anyway).
const companyJoin = and(
  eq(company.id, contact.companyId),
  eq(company.organizationId, contact.organizationId),
);

const owner = {
  id: user.id,
  name: user.name,
  email: user.email,
  image: user.image,
};

const companySummary = {
  id: company.id,
  name: company.name,
  domain: company.domain,
  iconUrl: company.iconUrl,
  iconDarkUrl: company.iconDarkUrl,
  iconTone: company.iconTone,
  logoUrl: company.logoUrl,
};

// Each word binds a pattern, and D1 binds at most 100 parameters a
// statement: six words are plenty.
const MAX_SEARCH_WORDS = 6;

// The name, email and company name, joined by spaces. A word has no spaces,
// so it turns up in the joined text exactly when it turns up in one of them,
// and binds one pattern instead of one per column.
const searchable = sql`coalesce(${contact.firstName}, '') || ' ' || coalesce(${contact.lastName}, '') || ' ' || coalesce(${contact.email}, '') || ' ' || coalesce(${company.name}, '')`;

/**
 * The search: every word must turn up in the first name, last name, email or
 * company name, so "ana acme" finds Ana at Acme.
 */
function searchWords(q: string): SQL | undefined {
  return and(
    ...q
      .trim()
      .split(/\s+/)
      .slice(0, MAX_SEARCH_WORDS)
      .map((word) => searchCondition(word, [searchable])),
  );
}

/** The company filter: the chosen companies, and `NO_COMPANY` for none. */
function companyCondition(values: string[]): SQL | undefined {
  if (values.length === 0) return undefined;
  const ids = values.filter((value) => value !== NO_COMPANY);
  return or(
    ids.length > 0 ? inArray(contact.companyId, ids) : undefined,
    ids.length < values.length ? isNull(contact.companyId) : undefined,
  );
}

/**
 * The list's scope: the live (or archived) contacts its search finds. The
 * search reads the company's name, so queries over it join `company`.
 */
function scopeWhere(organizationId: string, input: ContactListInput) {
  return and(
    eq(contact.organizationId, organizationId),
    archivedCondition(contact.archivedAt, input.archived),
    searchWords(input.q),
  );
}

/**
 * The scope narrowed by the list's filters, `fieldConditions` being its
 * custom field filters' conditions on `contact`.
 */
function listWhere(
  organizationId: string,
  input: ContactListInput,
  fieldConditions: SQL[],
) {
  return and(
    scopeWhere(organizationId, input),
    ownerCondition(contact.ownerId, input.owner),
    companyCondition(input.company),
    anyOfCondition(contact.title, input.title),
    anyOfCondition(contact.seniority, input.seniority),
    anyOfCondition(contact.function, input.persona),
    activityCondition(contact.lastActivityAt, input.activity),
    ...fieldConditions,
  );
}

type ContactFacetColumn =
  | typeof contact.ownerId
  | typeof contact.companyId
  | typeof contact.title
  | typeof contact.seniority
  | typeof contact.function;

/**
 * How many contacts in the list's scope have each value of its filters: each
 * owner (nobody's as UNASSIGNED), each company (none as NO_COMPANY), the
 * commonest titles, seniorities and personas, and each activity window.
 */
async function facetCounts(
  organizationId: string,
  input: ContactListInput,
): Promise<FacetCounts> {
  const where = scopeWhere(organizationId, input);
  const grouped = (column: ContactFacetColumn, condition = where) =>
    db
      .select({ value: column, count: count() })
      .from(contact)
      .leftJoin(company, companyJoin)
      .where(condition)
      .groupBy(column);
  // Free text: its commonest values.
  const commonest = (column: ContactFacetColumn) =>
    grouped(column, and(where, isNotNull(column)))
      .orderBy(desc(count()), asc(column))
      .limit(FILTER_OPTIONS_MAX);
  const [owners, companies, titles, seniorities, personas, [activity]] =
    await Promise.all([
      grouped(contact.ownerId),
      // Every company: the Company filter searches them all by name.
      grouped(contact.companyId),
      commonest(contact.title),
      commonest(contact.seniority),
      commonest(contact.function),
      db
        .select(activityCounts(contact.lastActivityAt))
        .from(contact)
        .leftJoin(company, companyJoin)
        .where(where),
    ]);
  return {
    owner: countsByValue(owners, UNASSIGNED),
    company: countsByValue(companies, NO_COMPANY),
    title: countsByValue(titles),
    seniority: countsByValue(seniorities),
    persona: countsByValue(personas),
    activity: activity ?? {},
  };
}

/** The ids of the contacts in the list's scope, as a subquery. */
function idsInScope(organizationId: string, input: ContactListInput) {
  return db
    .select({ id: contact.id })
    .from(contact)
    .leftJoin(company, companyJoin)
    .where(scopeWhere(organizationId, input));
}

async function list(
  organizationId: string,
  input: ContactListInput,
  fieldConditions: SQL[],
) {
  const where = listWhere(organizationId, input, fieldConditions);
  const { limit, offset } = pageWindow(input);
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email,
        title: contact.title,
        imageUrl: contact.imageUrl,
        enrichmentStatus: contact.enrichmentStatus,
        source: contact.source,
        lastActivityAt: contact.lastActivityAt,
        createdAt: contact.createdAt,
        archivedAt: contact.archivedAt,
        company: companySummary,
        owner,
      })
      .from(contact)
      .leftJoin(company, companyJoin)
      .leftJoin(user, eq(user.id, contact.ownerId))
      .where(where)
      .orderBy(...orderOf(input))
      .limit(limit)
      .offset(offset),
    db
      .select({ value: count() })
      .from(contact)
      .leftJoin(company, companyJoin)
      .where(where),
  ]);
  return { rows, total: total?.value ?? 0 };
}

/** One contact with its owner and company (and who that company's primary is). */
async function findById(organizationId: string, id: string) {
  const [row] = await db
    .select({
      contact,
      owner,
      company: {
        ...companySummary,
        industry: company.industry,
        primaryContactId: company.primaryContactId,
      },
    })
    .from(contact)
    .leftJoin(company, companyJoin)
    .leftJoin(user, eq(user.id, contact.ownerId))
    .where(inOrganization(organizationId, id))
    .limit(1);
  if (!row) return null;
  return { ...row.contact, owner: row.owner, company: row.company };
}

/** The live contact that has `email`, if any. */
async function findLiveByEmail(organizationId: string, email: string) {
  const [row] = await db
    .select({
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
    })
    .from(contact)
    .where(
      and(
        eq(contact.organizationId, organizationId),
        eq(contact.email, email),
        isNull(contact.archivedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

// A person added by hand, or given this address, is wanted in the CRM:
// captured mail may file them again.
function allowAgain(tx: typeof db, organizationId: string, email: string) {
  return tx
    .delete(suppressedContact)
    .where(
      and(
        eq(suppressedContact.organizationId, organizationId),
        eq(suppressedContact.email, email),
      ),
    );
}

type NewContact = {
  organizationId: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  companyId: string | null;
  ownerId: string | null;
  linkedinUrl?: string | null;
  source?: RecordSource;
};

/**
 * Inserts the contact, lifting any suppression of its email in the same
 * batch. Throws a unique violation when a live contact has the email.
 */
async function insert(values: NewContact): Promise<string> {
  const id = crypto.randomUUID();
  const { email, organizationId } = values;
  await runBatch((tx) => [
    tx.insert(contact).values({ ...values, id }),
    ...(email ? [allowAgain(tx, organizationId, email)] : []),
  ]);
  return id;
}

type ContactPatch = Partial<
  Omit<typeof contact.$inferInsert, "id" | "organizationId">
>;

/**
 * Changes the contact. A new email lifts its suppression; a new company
 * takes away the contact's primary claim on the company they left, so a
 * company never names someone who works elsewhere. Throws a unique
 * violation when a live contact already has the new email.
 */
async function update(organizationId: string, id: string, patch: ContactPatch) {
  const { email, companyId } = patch;
  await runBatch((tx) => [
    tx
      .update(contact)
      .set({ ...patch, updatedAt: new Date().toISOString() })
      .where(inOrganization(organizationId, id)),
    ...(companyId === undefined
      ? []
      : [leaveOtherCompanies(tx, organizationId, [id], companyId)]),
    ...(email ? [allowAgain(tx, organizationId, email)] : []),
  ]);
  const [row] = await db
    .select({
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      companyId: contact.companyId,
    })
    .from(contact)
    .where(inOrganization(organizationId, id));
  return row ?? null;
}

/** Archives the live contacts among `ids`; the ids it archived. */
async function archive(organizationId: string, ids: string[]) {
  const now = new Date().toISOString();
  const archived: string[] = [];
  for (const part of idChunks(ids)) {
    const rows = await db
      .update(contact)
      .set({ archivedAt: now, updatedAt: now })
      .where(
        and(
          eq(contact.organizationId, organizationId),
          inArray(contact.id, part),
          isNull(contact.archivedAt),
        ),
      )
      .returning({ id: contact.id });
    archived.push(...rows.map((row) => row.id));
  }
  return archived;
}

/**
 * Brings an archived contact back; null when it isn't the organization's or
 * isn't archived. Throws a unique violation when a live contact has taken
 * its email meanwhile.
 */
async function restore(organizationId: string, id: string) {
  const [row] = await db
    .update(contact)
    .set({ archivedAt: null, updatedAt: new Date().toISOString() })
    .where(
      and(inOrganization(organizationId, id), isNotNull(contact.archivedAt)),
    )
    .returning({
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
    });
  return row ?? null;
}

/** Gives `ids` to `ownerId` (or nobody); how many it changed. */
async function setOwner(
  organizationId: string,
  ids: string[],
  ownerId: string | null,
) {
  let changed = 0;
  for (const part of idChunks(ids)) {
    const rows = await db
      .update(contact)
      .set({ ownerId, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(contact.organizationId, organizationId),
          inArray(contact.id, part),
        ),
      )
      .returning({ id: contact.id });
    changed += rows.length;
  }
  return changed;
}

/**
 * Puts the contact back to "not researched yet" for the agent's new look,
 * unless something wrote to it since `seenAt`.
 */
async function markEnrichmentRequested(
  organizationId: string,
  id: string,
  seenAt: string,
) {
  await db
    .update(contact)
    .set({
      enrichmentStatus: "PENDING",
      enrichmentError: null,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(inOrganization(organizationId, id), eq(contact.updatedAt, seenAt)),
    );
}

export const ContactRepository = {
  list,
  facetCounts,
  idsInScope,
  findById,
  findLiveByEmail,
  insert,
  update,
  archive,
  restore,
  setOwner,
  markEnrichmentRequested,
};
