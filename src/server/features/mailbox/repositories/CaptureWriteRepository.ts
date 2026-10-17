import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  max,
  min,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  activity,
  company,
  contact,
  emailMessage,
  emailThread,
  suppressedContact,
  suppressedDomain,
} from "@/db/schema";
import { idChunks } from "@/server/features/records/recordRules";
import type { SyncSource } from "@/shared/mailbox";

// The only writer of captured mail and meetings: email_thread, email_message,
// calendar_event, calendar_attendee and their EMAIL and MEETING activities
// (one per thread, one per event), and the lookups matching does. Every
// statement names the organization. There are no transactions: each step is
// idempotent (unique RFC message ids, one thread per root, one activity per
// thread or event), so a write cut short is finished by the next check.

type Recipient = { email: string; name: string | null; kind: "to" | "cc" };

// --- matching -------------------------------------------------------------

/** The suppressed addresses and domains: people chose never to file them. */
async function suppressions(organizationId: string) {
  const [emails, domains] = await Promise.all([
    db
      .select({ email: suppressedContact.email })
      .from(suppressedContact)
      .where(eq(suppressedContact.organizationId, organizationId)),
    db
      .select({ domain: suppressedDomain.domain })
      .from(suppressedDomain)
      .where(eq(suppressedDomain.organizationId, organizationId)),
  ]);
  return {
    emails: new Set(emails.map((row) => row.email.toLowerCase())),
    domains: new Set(domains.map((row) => row.domain.toLowerCase())),
  };
}

/** A contact with one of `emails`, a live one first. */
async function contactByEmails(organizationId: string, emails: string[]) {
  for (const part of idChunks(emails)) {
    const [row] = await db
      .select({ id: contact.id, companyId: contact.companyId })
      .from(contact)
      .where(
        and(
          eq(contact.organizationId, organizationId),
          inArray(contact.email, part),
        ),
      )
      .orderBy(sql`(${contact.archivedAt} is not null)`)
      .limit(1);
    if (row) return row;
  }
  return null;
}

/** The contacts with `emails`, by address, live ones winning. */
async function contactsByEmail(
  organizationId: string,
  emails: string[],
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (const part of idChunks(emails)) {
    const rows = await db
      .select({ id: contact.id, email: contact.email })
      .from(contact)
      .where(
        and(
          eq(contact.organizationId, organizationId),
          inArray(contact.email, part),
        ),
      )
      .orderBy(desc(sql`(${contact.archivedAt} is not null)`));
    for (const row of rows) if (row.email) found.set(row.email, row.id);
  }
  return found;
}

/** The companies with `domains`, live ones winning: domain → id. */
async function companiesByDomain(
  organizationId: string,
  domains: string[],
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (const part of idChunks(domains)) {
    const rows = await db
      .select({ id: company.id, domain: company.domain })
      .from(company)
      .where(
        and(
          eq(company.organizationId, organizationId),
          inArray(company.domain, part),
        ),
      )
      .orderBy(desc(sql`(${company.archivedAt} is not null)`));
    for (const row of rows) if (row.domain) found.set(row.domain, row.id);
  }
  return found;
}

// --- email ----------------------------------------------------------------

/** The stored message with this RFC id, its thread's filing, and whether it has its activity. */
async function messageByRfc(organizationId: string, rfcMessageId: string) {
  const [row] = await db
    .select({
      threadId: emailMessage.threadId,
      companyId: emailThread.companyId,
      contactId: emailThread.contactId,
      activityId: activity.id,
    })
    .from(emailMessage)
    .innerJoin(
      emailThread,
      and(
        eq(emailThread.id, emailMessage.threadId),
        eq(emailThread.organizationId, organizationId),
      ),
    )
    .leftJoin(
      activity,
      and(
        eq(activity.emailThreadId, emailThread.id),
        eq(activity.organizationId, organizationId),
      ),
    )
    .where(
      and(
        eq(emailMessage.organizationId, organizationId),
        eq(emailMessage.rfcMessageId, rfcMessageId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function threadByRoot(organizationId: string, rootMessageId: string) {
  const [row] = await db
    .select({
      id: emailThread.id,
      companyId: emailThread.companyId,
      contactId: emailThread.contactId,
    })
    .from(emailThread)
    .where(
      and(
        eq(emailThread.organizationId, organizationId),
        eq(emailThread.rootMessageId, rootMessageId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Whether `mailbox` has sent anything in the conversation rooted at `rootMessageId`. */
async function hasSentInThread(
  organizationId: string,
  rootMessageId: string,
  mailbox: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: emailMessage.id })
    .from(emailMessage)
    .innerJoin(
      emailThread,
      and(
        eq(emailThread.id, emailMessage.threadId),
        eq(emailThread.organizationId, organizationId),
      ),
    )
    .where(
      and(
        eq(emailMessage.organizationId, organizationId),
        eq(emailThread.rootMessageId, rootMessageId),
        eq(emailMessage.fromEmail, mailbox),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Of Gmail's message ids, the ones already stored. */
async function storedGmailIds(
  organizationId: string,
  ids: string[],
): Promise<Set<string>> {
  const stored = new Set<string>();
  for (const part of idChunks(ids)) {
    const rows = await db
      .select({ id: emailMessage.gmailMessageId })
      .from(emailMessage)
      .where(
        and(
          eq(emailMessage.organizationId, organizationId),
          inArray(emailMessage.gmailMessageId, part),
        ),
      );
    for (const row of rows) if (row.id) stored.add(row.id);
  }
  return stored;
}

/** The thread for `rootMessageId`, created filed on the match when it is new. */
async function upsertThread(input: {
  organizationId: string;
  rootMessageId: string;
  subject: string | null;
  companyId: string | null;
  contactId: string | null;
  sentAt: string;
}): Promise<string> {
  const [row] = await db
    .insert(emailThread)
    .values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      rootMessageId: input.rootMessageId,
      subject: input.subject,
      companyId: input.companyId,
      contactId: input.contactId,
      firstMessageAt: input.sentAt,
      lastMessageAt: input.sentAt,
      messageCount: 0,
    })
    .onConflictDoUpdate({
      target: [emailThread.organizationId, emailThread.rootMessageId],
      set: { rootMessageId: input.rootMessageId },
    })
    .returning({ id: emailThread.id });
  if (!row) throw new Error("Email thread missing after upsert");
  return row.id;
}

/** Stores the message; false when the organization already has its RFC id. */
async function insertMessage(input: {
  organizationId: string;
  threadId: string;
  rfcMessageId: string;
  syncedByUserId: string;
  direction: "INBOUND" | "OUTBOUND";
  fromEmail: string;
  fromName: string | null;
  recipients: Recipient[];
  subject: string | null;
  snippet: string | null;
  body: string | null;
  sentAt: string;
  gmailMessageId: string | null;
  outlookMessageId: string | null;
  outlookWebLink: string | null;
}): Promise<boolean> {
  const rows = await db
    .insert(emailMessage)
    .values({ id: crypto.randomUUID(), ...input })
    .onConflictDoNothing({
      target: [emailMessage.organizationId, emailMessage.rfcMessageId],
    })
    .returning({ id: emailMessage.id });
  return rows.length > 0;
}

/**
 * Brings the thread's counts and dates up to its messages, the earliest
 * message naming it, and writes its one EMAIL activity (the newest
 * message's time, the snippet just stored). The activity's creation time,
 * which a record's last activity follows.
 */
async function projectThread(input: {
  organizationId: string;
  threadId: string;
  userId: string;
  message: { subject: string | null; snippet: string | null; sentAt: string };
  companyId: string | null;
  contactId: string | null;
  origin: SyncSource;
}): Promise<string> {
  const { organizationId, threadId } = input;
  const [stats] = await db
    .select({
      count: count(),
      first: min(emailMessage.sentAt),
      last: max(emailMessage.sentAt),
    })
    .from(emailMessage)
    .where(
      and(
        eq(emailMessage.organizationId, organizationId),
        eq(emailMessage.threadId, threadId),
      ),
    );
  const first = stats?.first ?? input.message.sentAt;
  const last = stats?.last ?? input.message.sentAt;
  const now = new Date().toISOString();
  await db
    .update(emailThread)
    .set({
      messageCount: stats?.count ?? 0,
      firstMessageAt: first,
      lastMessageAt: last,
      ...(input.message.sentAt <= first
        ? { subject: input.message.subject }
        : {}),
      updatedAt: now,
    })
    .where(
      and(
        eq(emailThread.organizationId, organizationId),
        eq(emailThread.id, threadId),
      ),
    );
  const [row] = await db
    .insert(activity)
    .values({
      id: crypto.randomUUID(),
      organizationId,
      type: "EMAIL",
      subject: input.message.subject ?? "(no subject)",
      body: input.message.snippet,
      occurredAt: last,
      companyId: input.companyId,
      contactId: input.contactId,
      createdById: input.userId,
      emailThreadId: threadId,
      meta: { synced: true, source: input.origin },
    })
    .onConflictDoUpdate({
      target: activity.emailThreadId,
      set: { body: input.message.snippet, occurredAt: last, updatedAt: now },
    })
    .returning({ createdAt: activity.createdAt });
  if (!row) throw new Error("Email activity missing after upsert");
  return row.createdAt;
}

// --- both -----------------------------------------------------------------

/** Moves the records' last activity up to `at`, never back. */
async function stamp(
  organizationId: string,
  target: { companyId: string | null; contactId: string | null },
  at: string,
) {
  const tables = [
    [company, target.companyId],
    [contact, target.contactId],
  ] as const;
  await runBatch((tx) =>
    tables.flatMap(([table, id]) =>
      id
        ? [
            tx
              .update(table)
              .set({ lastActivityAt: at })
              .where(
                and(
                  eq(table.organizationId, organizationId),
                  eq(table.id, id),
                  or(
                    isNull(table.lastActivityAt),
                    lt(table.lastActivityAt, at),
                  ),
                ),
              ),
          ]
        : [],
    ),
  );
}

/**
 * Deletes what the member's mailbox brought in from `provider` (Google:
 * Gmail messages and the meetings they synced; Microsoft: Outlook messages).
 * A thread left with no messages goes with its activity; one other members'
 * mail keeps is rebuilt from what is left. The records whose last activity
 * may move, and how many items went.
 */
export const CaptureWriteRepository = {
  suppressions,
  contactByEmails,
  contactsByEmail,
  companiesByDomain,
  messageByRfc,
  threadByRoot,
  hasSentInThread,
  storedGmailIds,
  upsertThread,
  insertMessage,
  projectThread,
  stamp,
};
