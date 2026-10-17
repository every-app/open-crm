import { and, asc, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import {
  activity,
  calendarEvent,
  company,
  contact,
  dealContact,
  deal,
  emailThread,
  user,
} from "@/db/schema";
import { daysSince, isOpen } from "./AgentAccountRepository";
import { AgentHistoryRepository as History } from "./AgentHistoryRepository";

// A deal's full history for the agent, ported from the CRM's lib/accounts.ts:
// the stage clock and every stage it moved through, the people on it with
// their ids, the correspondence and meetings with them, and the notes, in one
// free read. Scoped to the organization.

/** Everything the CRM has on a deal. Null when it isn't the organization's. */
async function dealHistory(
  organizationId: string,
  dealId: string,
  options: { threads: number },
) {
  const [row] = await db
    .select({
      id: deal.id,
      name: deal.name,
      description: deal.description,
      stage: deal.stage,
      stageChangedAt: deal.stageChangedAt,
      amount: deal.amount,
      currency: deal.currency,
      expectedCloseDate: deal.expectedCloseDate,
      closedAt: deal.closedAt,
      closedReason: deal.closedReason,
      lastActivityAt: deal.lastActivityAt,
      createdAt: deal.createdAt,
      ownerName: user.name,
      ownerEmail: user.email,
      companyId: company.id,
      companyName: company.name,
      companyDomain: company.domain,
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
      email: contact.email,
    })
    .from(dealContact)
    .innerJoin(contact, eq(contact.id, dealContact.contactId))
    .where(
      and(
        eq(dealContact.organizationId, organizationId),
        eq(dealContact.dealId, dealId),
      ),
    );
  // The deal's people as a subquery, not a bound list: a large buying
  // committee would pass D1's 100 bound parameters per statement.
  const contactIds = db
    .select({ id: dealContact.contactId })
    .from(dealContact)
    .where(
      and(
        eq(dealContact.organizationId, organizationId),
        eq(dealContact.dealId, dealId),
      ),
    );
  const related =
    people.length > 0
      ? or(
          inArray(emailThread.contactId, contactIds),
          eq(emailThread.companyId, row.companyId),
        )
      : eq(emailThread.companyId, row.companyId);
  const [stageChanges, threads, meetings, notes, inbound] = await Promise.all([
    db
      .select({ meta: activity.meta, createdAt: activity.createdAt })
      .from(activity)
      .where(
        and(
          eq(activity.organizationId, organizationId),
          eq(activity.dealId, dealId),
          eq(activity.type, "STAGE_CHANGE"),
        ),
      )
      .orderBy(asc(activity.createdAt))
      .limit(25),
    History.threadsWhere(organizationId, related, options.threads, 4),
    History.meetingsWhere(
      organizationId,
      people.length > 0
        ? or(
            History.meetingWith(organizationId, contactIds),
            eq(calendarEvent.companyId, row.companyId),
          )
        : eq(calendarEvent.companyId, row.companyId),
    ),
    History.notesFor(organizationId, eq(activity.dealId, dealId)),
    History.lastInbound(organizationId, related),
  ]);
  const now = Date.now();
  return {
    deal: {
      id: row.id,
      name: row.name,
      description: row.description,
      stage: row.stage,
      open: isOpen(row.stage),
      daysInStage: daysSince(row.stageChangedAt, now),
      stageChangedAt: row.stageChangedAt,
      amount: row.amount,
      currency: row.currency,
      expectedCloseDate: row.expectedCloseDate,
      closedAt: row.closedAt,
      closedReason: row.closedReason,
      owner: row.ownerName ?? row.ownerEmail ?? null,
      createdAt: row.createdAt,
    },
    company: {
      id: row.companyId,
      name: row.companyName,
      domain: row.companyDomain,
    },
    people: people.map((person) => ({
      id: person.id,
      name: History.name(person),
      title: person.title,
      email: person.email,
      role: person.role,
    })),
    stageHistory: stageChanges.map((change) => ({
      ...stageMove(change.meta),
      at: change.createdAt,
    })),
    threads,
    meetings,
    notes,
    stats: {
      theyReplied: inbound !== null,
      lastReplyAt: inbound?.sentAt ?? null,
      lastReplyFrom: inbound ? (inbound.fromName ?? inbound.fromEmail) : null,
      nextMeetingAt: History.nextMeetingAt(meetings),
      daysSinceLastActivity: row.lastActivityAt
        ? daysSince(row.lastActivityAt, now)
        : null,
    },
    note:
      people.length > 0
        ? "Connected account history is filed against people and companies, never against a deal. The history here belongs to the people on this deal and the rest of the account — read the details before treating any of it as being about this deal."
        : "Nobody is attached to this deal, so the correspondence here is the whole account's. Attaching the people on it would make this answer sharper.",
  };
}

function stageMove(meta: unknown): { from: string | null; to: string | null } {
  if (typeof meta !== "object" || meta === null)
    return { from: null, to: null };
  const from: unknown = Reflect.get(meta, "from");
  const to: unknown = Reflect.get(meta, "to");
  return {
    from: typeof from === "string" ? from : null,
    to: typeof to === "string" ? to : null,
  };
}

export const AgentDealRepository = {
  dealHistory,
};
