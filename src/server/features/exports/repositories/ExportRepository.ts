import { and, asc, eq, gt, inArray, isNull, type Column } from "drizzle-orm";
import { db } from "@/db";
import {
  activity,
  calendarAttendee,
  calendarEvent,
  company,
  contact,
  deal,
  dealContact,
  emailMessage,
  emailThread,
  formSubmission,
  trackedEvent,
  trackedVisitor,
  user,
} from "@/db/schema";
import { idChunks } from "@/server/features/records/recordRules";

// Everything an organization holds, a page at a time, for an owner's full
// export (ExportService): rows in id order after `after`, each with the names
// and addresses a spreadsheet needs in place of ids. Every read filters by
// the organization, joined tables included.

export type Page = { after: string | null; limit: number };

const NOTE_TYPES = ["NOTE", "CALL", "EMAIL", "MEETING"] as const;

function after(id: Column, page: Page) {
  return page.after === null ? undefined : gt(id, page.after);
}

/** Joins a record of the organization by its id column. */
function ours(
  table: typeof company | typeof contact | typeof deal,
  organizationId: string,
  id: Column,
) {
  return and(eq(table.id, id), eq(table.organizationId, organizationId));
}

async function companies(organizationId: string, page: Page) {
  return db
    .select({ company, ownerEmail: user.email })
    .from(company)
    .leftJoin(user, eq(user.id, company.ownerId))
    .where(
      and(eq(company.organizationId, organizationId), after(company.id, page)),
    )
    .orderBy(asc(company.id))
    .limit(page.limit);
}

async function contacts(organizationId: string, page: Page) {
  return db
    .select({
      contact,
      companyName: company.name,
      companyDomain: company.domain,
      ownerEmail: user.email,
    })
    .from(contact)
    .leftJoin(company, ours(company, organizationId, contact.companyId))
    .leftJoin(user, eq(user.id, contact.ownerId))
    .where(
      and(eq(contact.organizationId, organizationId), after(contact.id, page)),
    )
    .orderBy(asc(contact.id))
    .limit(page.limit);
}

async function deals(organizationId: string, page: Page) {
  return db
    .select({ deal, companyName: company.name, ownerEmail: user.email })
    .from(deal)
    .leftJoin(company, ours(company, organizationId, deal.companyId))
    .leftJoin(user, eq(user.id, deal.ownerId))
    .where(and(eq(deal.organizationId, organizationId), after(deal.id, page)))
    .orderBy(asc(deal.id))
    .limit(page.limit);
}

/** The contacts on each of `dealIds`. */
async function dealContacts(organizationId: string, dealIds: string[]) {
  const rows = [];
  for (const ids of idChunks(dealIds)) {
    rows.push(
      ...(await db
        .select({
          dealId: dealContact.dealId,
          email: contact.email,
          firstName: contact.firstName,
          lastName: contact.lastName,
        })
        .from(dealContact)
        .innerJoin(
          contact,
          ours(contact, organizationId, dealContact.contactId),
        )
        .where(
          and(
            eq(dealContact.organizationId, organizationId),
            inArray(dealContact.dealId, ids),
          ),
        )),
    );
  }
  return rows;
}

/**
 * Notes (what people and the agent logged: notes, calls, emails and
 * meetings, not the captured ones) or tasks, with what each is on.
 */
async function activities(
  organizationId: string,
  kind: "notes" | "tasks",
  page: Page,
) {
  return db
    .select({
      activity,
      companyName: company.name,
      contactEmail: contact.email,
      contactFirstName: contact.firstName,
      contactLastName: contact.lastName,
      dealName: deal.name,
      authorEmail: user.email,
    })
    .from(activity)
    .leftJoin(company, ours(company, organizationId, activity.companyId))
    .leftJoin(contact, ours(contact, organizationId, activity.contactId))
    .leftJoin(deal, ours(deal, organizationId, activity.dealId))
    .leftJoin(user, eq(user.id, activity.createdById))
    .where(
      and(
        eq(activity.organizationId, organizationId),
        kind === "tasks"
          ? eq(activity.type, "TASK")
          : and(
              inArray(activity.type, [...NOTE_TYPES]),
              isNull(activity.emailThreadId),
              isNull(activity.calendarEventId),
            ),
        after(activity.id, page),
      ),
    )
    .orderBy(asc(activity.id))
    .limit(page.limit);
}

/** Captured email, a message a row, with its thread's records. */
async function emails(organizationId: string, page: Page) {
  return db
    .select({
      message: emailMessage,
      companyName: company.name,
      contactEmail: contact.email,
    })
    .from(emailMessage)
    .innerJoin(
      emailThread,
      and(
        eq(emailThread.id, emailMessage.threadId),
        eq(emailThread.organizationId, organizationId),
      ),
    )
    .leftJoin(company, ours(company, organizationId, emailThread.companyId))
    .leftJoin(contact, ours(contact, organizationId, emailThread.contactId))
    .where(
      and(
        eq(emailMessage.organizationId, organizationId),
        after(emailMessage.id, page),
      ),
    )
    .orderBy(asc(emailMessage.id))
    .limit(page.limit);
}

/** Captured meetings, with their records. */
async function meetings(organizationId: string, page: Page) {
  return db
    .select({
      event: calendarEvent,
      companyName: company.name,
      contactEmail: contact.email,
    })
    .from(calendarEvent)
    .leftJoin(company, ours(company, organizationId, calendarEvent.companyId))
    .leftJoin(contact, ours(contact, organizationId, calendarEvent.contactId))
    .where(
      and(
        eq(calendarEvent.organizationId, organizationId),
        after(calendarEvent.id, page),
      ),
    )
    .orderBy(asc(calendarEvent.id))
    .limit(page.limit);
}

/** The attendees of each of `eventIds`. */
async function attendees(organizationId: string, eventIds: string[]) {
  const rows = [];
  for (const ids of idChunks(eventIds)) {
    rows.push(
      ...(await db
        .select({
          eventId: calendarAttendee.eventId,
          email: calendarAttendee.email,
        })
        .from(calendarAttendee)
        .where(
          and(
            eq(calendarAttendee.organizationId, organizationId),
            inArray(calendarAttendee.eventId, ids),
          ),
        )),
    );
  }
  return rows;
}

/** Page views and clicks, with the contact a visitor turned out to be. */
async function websiteActivity(organizationId: string, page: Page) {
  return db
    .select({ event: trackedEvent, contactEmail: contact.email })
    .from(trackedEvent)
    .leftJoin(
      trackedVisitor,
      and(
        eq(trackedVisitor.organizationId, trackedEvent.organizationId),
        eq(trackedVisitor.id, trackedEvent.visitorId),
      ),
    )
    .leftJoin(contact, ours(contact, organizationId, trackedVisitor.contactId))
    .where(
      and(
        eq(trackedEvent.organizationId, organizationId),
        after(trackedEvent.id, page),
      ),
    )
    .orderBy(asc(trackedEvent.id))
    .limit(page.limit);
}

async function formSubmissions(organizationId: string, page: Page) {
  return db
    .select({ submission: formSubmission, contactEmail: contact.email })
    .from(formSubmission)
    .leftJoin(contact, ours(contact, organizationId, formSubmission.contactId))
    .where(
      and(
        eq(formSubmission.organizationId, organizationId),
        after(formSubmission.id, page),
      ),
    )
    .orderBy(asc(formSubmission.id))
    .limit(page.limit);
}

export const ExportRepository = {
  companies,
  contacts,
  deals,
  dealContacts,
  activities,
  emails,
  meetings,
  attendees,
  websiteActivity,
  formSubmissions,
};
