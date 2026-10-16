import { and, asc, count, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { chunk } from "remeda";
import { db } from "@/db";
import {
  activity,
  calendarEvent,
  company,
  contact,
  deal,
  dealContact,
  emailMessage,
  emailThread,
  user,
} from "@/db/schema";
import { isDerivedName } from "../lib/names";
import { AgentHistoryRepository as History } from "./AgentHistoryRepository";
import { descNullsLast } from "./order";

// A company's and a deal's full history for the agent, ported from the CRM's
// lib/accounts.ts: every person and deal with their ids, the correspondence
// and meetings, and the notes, in one free read. Scoped to the organization.

const CLOSED_STAGES = ["CLOSED_WON", "CLOSED_LOST", "UNQUALIFIED_TO_BUY"];

/** Message and meeting counts for each of `contactIds`. */
async function contactActivityCounts(
  organizationId: string,
  contactIds: string[],
) {
  const threads = new Map<string, number>();
  const meetings = new Map<string, number>();
  for (const part of chunk(contactIds, 90)) {
    const [threadRows, meetingRows] = await Promise.all([
      db
        .select({ contactId: emailThread.contactId, value: count() })
        .from(emailThread)
        .where(
          and(
            eq(emailThread.organizationId, organizationId),
            inArray(emailThread.contactId, part),
          ),
        )
        .groupBy(emailThread.contactId),
      db
        .select({ contactId: calendarEvent.contactId, value: count() })
        .from(calendarEvent)
        .where(
          and(
            eq(calendarEvent.organizationId, organizationId),
            inArray(calendarEvent.contactId, part),
          ),
        )
        .groupBy(calendarEvent.contactId),
    ]);
    for (const row of threadRows)
      if (row.contactId) threads.set(row.contactId, row.value);
    for (const row of meetingRows)
      if (row.contactId) meetings.set(row.contactId, row.value);
  }
  return { threads, meetings };
}

/** The ids of a company's contacts, as a subquery. */
function companyContacts(organizationId: string, companyId: string) {
  return db
    .select({ id: contact.id })
    .from(contact)
    .where(
      and(
        eq(contact.organizationId, organizationId),
        eq(contact.companyId, companyId),
      ),
    );
}

function isOpen(stage: string): boolean {
  return !CLOSED_STAGES.includes(stage);
}

function daysSince(iso: string, now: number): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000));
}

/** Everything the CRM has on a company. Null when it isn't the organization's. */
async function companyHistory(
  organizationId: string,
  companyId: string,
  options: { threads: number; people: number },
) {
  const [row] = await db
    .select({
      id: company.id,
      name: company.name,
      domain: company.domain,
      website: company.website,
      industry: company.industry,
      subIndustry: company.subIndustry,
      city: company.city,
      country: company.country,
      description: company.description,
      linkedinUrl: company.linkedinUrl,
      enrichmentStatus: company.enrichmentStatus,
    })
    .from(company)
    .where(
      and(
        eq(company.organizationId, organizationId),
        eq(company.id, companyId),
      ),
    )
    .limit(1);
  if (!row) return null;
  const people = companyContacts(organizationId, companyId);
  const accountThreads = or(
    eq(emailThread.companyId, companyId),
    inArray(emailThread.contactId, people),
  );
  const [contacts, deals, threads, meetings, notes, inbound, counts] =
    await Promise.all([
      db
        .select({
          id: contact.id,
          firstName: contact.firstName,
          lastName: contact.lastName,
          title: contact.title,
          email: contact.email,
          linkedinUrl: contact.linkedinUrl,
          lastActivityAt: contact.lastActivityAt,
        })
        .from(contact)
        .where(
          and(
            eq(contact.organizationId, organizationId),
            eq(contact.companyId, companyId),
            isNull(contact.archivedAt),
          ),
        )
        .orderBy(descNullsLast(contact.lastActivityAt), asc(contact.createdAt))
        .limit(options.people),
      accountDeals(organizationId, companyId),
      History.threadsWhere(organizationId, accountThreads, options.threads, 4),
      History.meetingsWhere(
        organizationId,
        or(
          eq(calendarEvent.companyId, companyId),
          History.meetingWith(organizationId, people),
        ),
      ),
      History.notesFor(organizationId, eq(activity.companyId, companyId)),
      History.lastInbound(organizationId, accountThreads),
      Promise.all([
        db
          .select({ value: count() })
          .from(contact)
          .where(
            and(
              eq(contact.organizationId, organizationId),
              eq(contact.companyId, companyId),
              isNull(contact.archivedAt),
            ),
          ),
        db
          .select({ value: count() })
          .from(emailMessage)
          .where(
            and(
              eq(emailMessage.organizationId, organizationId),
              inArray(
                emailMessage.threadId,
                db
                  .select({ id: emailThread.id })
                  .from(emailThread)
                  .where(
                    and(
                      eq(emailThread.organizationId, organizationId),
                      accountThreads,
                    ),
                  ),
              ),
            ),
          ),
      ]),
    ]);
  const activityCounts = await contactActivityCounts(
    organizationId,
    contacts.map((person) => person.id),
  );
  const [[peopleCount], [emailCount]] = counts;
  return {
    company: {
      id: row.id,
      name: row.name,
      domain: row.domain,
      website: row.website,
      industry: [row.industry, row.subIndustry].filter(Boolean).join(" / "),
      location: [row.city, row.country].filter(Boolean).join(", "),
      description: row.description,
      linkedinUrl: row.linkedinUrl,
      enrichmentStatus: row.enrichmentStatus,
    },
    people: contacts.map((person) => ({
      id: person.id,
      name: History.name(person),
      title: person.title,
      email: person.email,
      linkedinUrl: person.linkedinUrl,
      lastActivityAt: person.lastActivityAt,
      threads: activityCounts.threads.get(person.id) ?? 0,
      meetings: activityCounts.meetings.get(person.id) ?? 0,
      needsIdentity: isDerivedName(
        person.email,
        person.firstName,
        person.lastName,
      ),
    })),
    deals,
    threads,
    meetings,
    notes,
    stats: {
      people: peopleCount?.value ?? 0,
      openDeals: deals.filter((item) => item.open).length,
      emails: emailCount?.value ?? 0,
      meetings: meetings.length,
      theyReplied: inbound !== null,
      lastReplyAt: inbound?.sentAt ?? null,
      lastReplyFrom: inbound ? (inbound.fromName ?? inbound.fromEmail) : null,
      nextMeetingAt: History.nextMeetingAt(meetings),
    },
  };
}

async function accountDeals(organizationId: string, companyId: string) {
  const deals = await db
    .select({
      id: deal.id,
      name: deal.name,
      stage: deal.stage,
      amount: deal.amount,
      currency: deal.currency,
      expectedCloseDate: deal.expectedCloseDate,
      lastActivityAt: deal.lastActivityAt,
    })
    .from(deal)
    .where(
      and(
        eq(deal.organizationId, organizationId),
        eq(deal.companyId, companyId),
        isNull(deal.archivedAt),
      ),
    )
    .orderBy(descNullsLast(deal.lastActivityAt), desc(deal.createdAt))
    .limit(20);
  if (deals.length === 0) return [];
  const people = await db
    .select({
      dealId: dealContact.dealId,
      role: dealContact.role,
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
    })
    .from(dealContact)
    .innerJoin(contact, eq(contact.id, dealContact.contactId))
    .where(
      and(
        eq(dealContact.organizationId, organizationId),
        inArray(
          dealContact.dealId,
          deals.map((item) => item.id),
        ),
      ),
    );
  return deals.map((item) => ({
    ...item,
    open: isOpen(item.stage),
    contacts: people
      .filter((person) => person.dealId === item.id)
      .map((person) => ({
        id: person.id,
        name: History.name(person),
        role: person.role,
      })),
  }));
}

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
  const contactIds = people.map((person) => person.id);
  const related =
    contactIds.length > 0
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
      contactIds.length > 0
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
      contactIds.length > 0
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

export const AgentAccountRepository = {
  companyHistory,
  dealHistory,
};
