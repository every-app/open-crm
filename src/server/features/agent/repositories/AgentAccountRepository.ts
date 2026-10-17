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
} from "@/db/schema";
import { isDerivedName } from "../lib/names";
import {
  AgentHistoryRepository as History,
  type Sources,
} from "./AgentHistoryRepository";
import { descNullsLast } from "./order";

// A company's full history for the agent, ported from the CRM's
// lib/accounts.ts: every person and deal with their ids, the correspondence
// and meetings (those `Sources` grants), and the notes, in one free read.
// Scoped to the organization.

const CLOSED_STAGES = ["CLOSED_WON", "CLOSED_LOST", "UNQUALIFIED_TO_BUY"];

/** Thread and meeting counts for each of `contactIds`, from `sources`. */
async function contactActivityCounts(
  organizationId: string,
  contactIds: string[],
  sources: Sources,
) {
  const threads = new Map<string, number>();
  const meetings = new Map<string, number>();
  for (const part of chunk(contactIds, 90)) {
    const [threadRows, meetingRows] = await Promise.all([
      sources.email
        ? db
            .select({ contactId: emailThread.contactId, value: count() })
            .from(emailThread)
            .where(
              and(
                eq(emailThread.organizationId, organizationId),
                inArray(emailThread.contactId, part),
              ),
            )
            .groupBy(emailThread.contactId)
        : [],
      sources.calendar
        ? db
            .select({ contactId: calendarEvent.contactId, value: count() })
            .from(calendarEvent)
            .where(
              and(
                eq(calendarEvent.organizationId, organizationId),
                inArray(calendarEvent.contactId, part),
              ),
            )
            .groupBy(calendarEvent.contactId)
        : [],
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

export function isOpen(stage: string): boolean {
  return !CLOSED_STAGES.includes(stage);
}

export function daysSince(iso: string, now: number): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000));
}

/** Everything the CRM has on a company. Null when it isn't the organization's. */
async function companyHistory(
  organizationId: string,
  companyId: string,
  options: { threads: number; people: number } & Sources,
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
      options.email
        ? History.threadsWhere(
            organizationId,
            accountThreads,
            options.threads,
            4,
          )
        : [],
      options.calendar
        ? History.meetingsWhere(
            organizationId,
            or(
              eq(calendarEvent.companyId, companyId),
              History.meetingWith(organizationId, people),
            ),
          )
        : [],
      History.notesFor(organizationId, eq(activity.companyId, companyId)),
      options.email
        ? History.lastInbound(organizationId, accountThreads)
        : null,
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
        options.email
          ? db
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
              )
          : [],
      ]),
    ]);
  const activityCounts = await contactActivityCounts(
    organizationId,
    contacts.map((person) => person.id),
    options,
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
      threads: options.email
        ? (activityCounts.threads.get(person.id) ?? 0)
        : null,
      meetings: options.calendar
        ? (activityCounts.meetings.get(person.id) ?? 0)
        : null,
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
      emails: options.email ? (emailCount?.value ?? 0) : null,
      meetings: options.calendar ? meetings.length : null,
      theyReplied: options.email ? inbound !== null : null,
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

export const AgentAccountRepository = {
  companyHistory,
};
