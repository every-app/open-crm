import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
} from "drizzle-orm";
import { chunk } from "remeda";
import { db } from "@/db";
import { agentTask, company, contact, deal } from "@/db/schema";

// The organization's view of the agent's queue, for the enrichment queue on
// Home (the CRM's EnrichmentService): the open tasks about its records, due
// or booked for later, and the records they are about. Work on the workspace
// itself has no record to open, so it is left out, as in the CRM.

// D1 binds at most 100 parameters per statement: id lists go in chunks.
const ID_CHUNK = 90;

const taskColumns = {
  id: agentTask.id,
  kind: agentTask.kind,
  reason: agentTask.reason,
  contactId: agentTask.contactId,
  companyId: agentTask.companyId,
  dealId: agentTask.dealId,
  attempts: agentTask.attempts,
  leasedUntil: agentTask.leasedUntil,
  startedAt: agentTask.startedAt,
  dueAt: agentTask.dueAt,
};

const openAboutARecord = (organizationId: string) =>
  and(
    eq(agentTask.organizationId, organizationId),
    isNull(agentTask.finishedAt),
    or(
      isNotNull(agentTask.contactId),
      isNotNull(agentTask.companyId),
      isNotNull(agentTask.dealId),
    ),
  );

/** Open tasks due by `now`, most urgent first, and how many there are. */
async function due(organizationId: string, now: string, limit: number) {
  const where = and(
    openAboutARecord(organizationId),
    lte(agentTask.dueAt, now),
  );
  const [tasks, [total]] = await Promise.all([
    db
      .select(taskColumns)
      .from(agentTask)
      .where(where)
      .orderBy(
        desc(agentTask.priority),
        asc(agentTask.dueAt),
        asc(agentTask.id),
      )
      .limit(limit),
    db.select({ value: count() }).from(agentTask).where(where),
  ]);
  return { tasks, total: total?.value ?? 0 };
}

/** Open tasks booked for after `now`, soonest first, and how many. */
async function booked(organizationId: string, now: string, limit: number) {
  const where = and(openAboutARecord(organizationId), gt(agentTask.dueAt, now));
  const [tasks, [total]] = await Promise.all([
    db
      .select(taskColumns)
      .from(agentTask)
      .where(where)
      .orderBy(asc(agentTask.dueAt), asc(agentTask.id))
      .limit(limit),
    db.select({ value: count() }).from(agentTask).where(where),
  ]);
  return { tasks, total: total?.value ?? 0 };
}

/** The organization's contacts, companies and deals the tasks are about. */
async function records(
  organizationId: string,
  ids: { contactIds: string[]; companyIds: string[]; dealIds: string[] },
) {
  const [contacts, companies, deals] = await Promise.all([
    Promise.all(
      chunk(ids.contactIds, ID_CHUNK).map((part) =>
        db
          .select({
            id: contact.id,
            firstName: contact.firstName,
            lastName: contact.lastName,
            email: contact.email,
            imageUrl: contact.imageUrl,
          })
          .from(contact)
          .where(
            and(
              eq(contact.organizationId, organizationId),
              inArray(contact.id, part),
            ),
          ),
      ),
    ),
    Promise.all(
      chunk(ids.companyIds, ID_CHUNK).map((part) =>
        db
          .select({
            id: company.id,
            name: company.name,
            iconUrl: company.iconUrl,
            logoUrl: company.logoUrl,
            iconDarkUrl: company.iconDarkUrl,
            logoDarkUrl: company.logoDarkUrl,
            iconTone: company.iconTone,
          })
          .from(company)
          .where(
            and(
              eq(company.organizationId, organizationId),
              inArray(company.id, part),
            ),
          ),
      ),
    ),
    Promise.all(
      chunk(ids.dealIds, ID_CHUNK).map((part) =>
        db
          .select({ id: deal.id, name: deal.name })
          .from(deal)
          .where(
            and(
              eq(deal.organizationId, organizationId),
              inArray(deal.id, part),
            ),
          ),
      ),
    ),
  ]);
  return {
    contacts: contacts.flat(),
    companies: companies.flat(),
    deals: deals.flat(),
  };
}

export const EnrichmentQueueRepository = {
  due,
  booked,
  records,
};
