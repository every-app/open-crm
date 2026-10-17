import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import { company, contact, deal, user } from "@/db/schema";
import type { RecordSource } from "@/shared/crm-enums";
import { OPEN_DEAL_STAGES } from "@/shared/deal-stages";
import {
  archivedCondition,
  ownerCondition,
  pageWindow,
  searchCondition,
  sortOrder,
  type SortSpec,
} from "@/server/features/records/listQuery";
import { idChunks } from "@/server/features/records/recordRules";
import type { CompanyListInput, CompanySort } from "@/types/schemas/companies";

const SORTS = {
  name: { by: sql`lower(${company.name})` },
  lastActivity: { by: company.lastActivityAt, nullsLast: true },
  createdAt: { by: company.createdAt },
} satisfies Record<CompanySort, SortSpec>;

const ownerColumns = {
  ownerId: company.ownerId,
  ownerName: user.name,
  ownerEmail: user.email,
  ownerImage: user.image,
};

type OwnerColumns = {
  ownerId: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  ownerImage: string | null;
};

type Owner = {
  id: string;
  name: string;
  email: string;
  image: string | null;
};

function ownerOf(row: OwnerColumns): Owner | null {
  if (!row.ownerId || row.ownerName === null || row.ownerEmail === null) {
    return null;
  }
  return {
    id: row.ownerId,
    name: row.ownerName,
    email: row.ownerEmail,
    image: row.ownerImage,
  };
}

function inOrganization(organizationId: string, id: string) {
  return and(eq(company.organizationId, organizationId), eq(company.id, id));
}

/** `fieldConditions`: the custom field filters' conditions on `company`. */
function listWhere(
  organizationId: string,
  input: CompanyListInput,
  fieldConditions: SQL[],
) {
  return and(
    eq(company.organizationId, organizationId),
    archivedCondition(company.archivedAt, input.archived),
    searchCondition(input.q, [company.name, company.domain]),
    ownerCondition(company.ownerId, input.owner),
    ...fieldConditions,
  );
}

// Live contacts and live open deals: archived records stay out of every
// count, as they stay out of every list.
const contactCount =
  sql<number>`(select count(*) from ${contact} where ${contact.organizationId} = ${company.organizationId} and ${contact.companyId} = ${company.id} and ${contact.archivedAt} is null)`.mapWith(
    Number,
  );

const openDealCount =
  sql<number>`(select count(*) from ${deal} where ${deal.organizationId} = ${company.organizationId} and ${deal.companyId} = ${company.id} and ${deal.archivedAt} is null and ${inArray(deal.stage, OPEN_DEAL_STAGES)})`.mapWith(
    Number,
  );

async function list(
  organizationId: string,
  input: CompanyListInput,
  fieldConditions: SQL[],
) {
  const where = listWhere(organizationId, input, fieldConditions);
  const { limit, offset } = pageWindow(input);
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: company.id,
        name: company.name,
        domain: company.domain,
        logoUrl: company.logoUrl,
        iconUrl: company.iconUrl,
        iconDarkUrl: company.iconDarkUrl,
        iconTone: company.iconTone,
        industry: company.industry,
        city: company.city,
        stateCode: company.stateCode,
        country: company.country,
        enrichmentStatus: company.enrichmentStatus,
        source: company.source,
        lastActivityAt: company.lastActivityAt,
        createdAt: company.createdAt,
        archivedAt: company.archivedAt,
        contactCount,
        openDealCount,
        ...ownerColumns,
      })
      .from(company)
      .leftJoin(user, eq(user.id, company.ownerId))
      .where(where)
      .orderBy(...sortOrder(SORTS[input.sort], input.dir, company.id))
      .limit(limit)
      .offset(offset),
    db.select({ value: count() }).from(company).where(where),
  ]);
  return {
    rows: rows.map(
      ({ ownerId, ownerName, ownerEmail, ownerImage, ...row }) => ({
        ...row,
        owner: ownerOf({ ownerId, ownerName, ownerEmail, ownerImage }),
      }),
    ),
    total: total?.value ?? 0,
  };
}

async function findById(organizationId: string, id: string) {
  const [row] = await db
    .select({ company, ...ownerColumns })
    .from(company)
    .leftJoin(user, eq(user.id, company.ownerId))
    .where(inOrganization(organizationId, id))
    .limit(1);
  if (!row) return null;
  return { ...row.company, owner: ownerOf(row) };
}

/** Live companies whose name or domain contains `q`, for pickers. */
async function options(organizationId: string, q: string) {
  return db
    .select({
      id: company.id,
      name: company.name,
      domain: company.domain,
      iconUrl: company.iconUrl,
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
    .limit(100);
}

type NewCompany = {
  organizationId: string;
  name: string;
  domain: string | null;
  website: string | null;
  ownerId: string | null;
  source?: RecordSource;
};

/**
 * Inserts the company unless a live one of the organization already has its
 * domain (the partial unique index company_organization_domain_active_uidx):
 * then `created` is false and the row is that company. One statement on both
 * backends, so two requests racing to add a domain can't both win.
 */
async function insert(values: NewCompany) {
  const id = crypto.randomUUID();
  const returning = { id: company.id, name: company.name };
  if (!values.domain) {
    const [row] = await db
      .insert(company)
      .values({ ...values, id })
      .returning(returning);
    if (!row) throw new Error("Company row missing after insert");
    return { ...row, created: true };
  }
  // A no-op upsert rather than DO NOTHING (AgentTaskRepository.insertIfAbsent
  // says why): RETURNING names the live company that holds the domain.
  const [row] = await db
    .insert(company)
    .values({ ...values, id })
    .onConflictDoUpdate({
      target: [company.organizationId, company.domain],
      targetWhere: sql`${company.archivedAt} is null`,
      set: { domain: values.domain },
    })
    .returning(returning);
  if (!row) throw new Error("Company row missing after insert");
  return { ...row, created: row.id === id };
}

/** The changed company, or null when it isn't the organization's. */
async function update(
  organizationId: string,
  id: string,
  patch: Partial<Omit<typeof company.$inferInsert, "id" | "organizationId">>,
) {
  const [row] = await db
    .update(company)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(inOrganization(organizationId, id))
    .returning({ id: company.id, name: company.name, domain: company.domain });
  return row ?? null;
}

/** Archives the live companies among `ids`; the ids it archived. */
async function archive(organizationId: string, ids: string[]) {
  const now = new Date().toISOString();
  const archived: string[] = [];
  for (const part of idChunks(ids)) {
    const rows = await db
      .update(company)
      .set({ archivedAt: now, updatedAt: now })
      .where(
        and(
          eq(company.organizationId, organizationId),
          inArray(company.id, part),
          isNull(company.archivedAt),
        ),
      )
      .returning({ id: company.id });
    archived.push(...rows.map((row) => row.id));
  }
  return archived;
}

/**
 * Brings an archived company back; null when it isn't the organization's or
 * isn't archived. Throws a unique violation when a live company has taken
 * its domain meanwhile.
 */
async function restore(organizationId: string, id: string) {
  const [row] = await db
    .update(company)
    .set({ archivedAt: null, updatedAt: new Date().toISOString() })
    .where(
      and(inOrganization(organizationId, id), isNotNull(company.archivedAt)),
    )
    .returning({ id: company.id, name: company.name });
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
      .update(company)
      .set({ ownerId, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(company.organizationId, organizationId),
          inArray(company.id, part),
        ),
      )
      .returning({ id: company.id });
    changed += rows.length;
  }
  return changed;
}

/**
 * Makes `contactId` the company's primary contact (or none). A contact is
 * primary at one company at most: one that moved keeps no stale claim on the
 * company it left.
 */
async function setPrimaryContact(
  organizationId: string,
  companyId: string,
  contactId: string | null,
) {
  const now = new Date().toISOString();
  await runBatch((tx) => [
    ...(contactId
      ? [
          tx
            .update(company)
            .set({ primaryContactId: null, updatedAt: now })
            .where(
              and(
                eq(company.organizationId, organizationId),
                eq(company.primaryContactId, contactId),
                ne(company.id, companyId),
              ),
            ),
        ]
      : []),
    tx
      .update(company)
      .set({ primaryContactId: contactId, updatedAt: now })
      .where(inOrganization(organizationId, companyId)),
  ]);
}

/**
 * Puts the company back to "not researched yet" for the agent's new look,
 * unless something wrote to it since `seenAt`.
 */
async function markEnrichmentRequested(
  organizationId: string,
  id: string,
  seenAt: string,
) {
  await db
    .update(company)
    .set({
      enrichmentStatus: "PENDING",
      enrichmentError: null,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(inOrganization(organizationId, id), eq(company.updatedAt, seenAt)),
    );
}

export const CompanyRepository = {
  list,
  findById,
  options,
  insert,
  update,
  archive,
  restore,
  setOwner,
  setPrimaryContact,
  markEnrichmentRequested,
};
