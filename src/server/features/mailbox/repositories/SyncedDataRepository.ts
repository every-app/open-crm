import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  activity,
  calendarEvent,
  emailMessage,
  emailThread,
} from "@/db/schema";
import { idChunks } from "@/server/features/records/recordRules";
import type { ActivityTargets } from "@/server/features/archive/repositories/ArchiveRepository";
import type { MailboxProvider } from "@/shared/mailbox";
// "Delete synced data": what one member's mailbox brought in, gone, with the
// threads other members' mail still holds rebuilt from what is left.

async function purgeSynced(
  organizationId: string,
  userId: string,
  provider: MailboxProvider,
): Promise<{ purged: number; targets: ActivityTargets }> {
  const mine = and(
    eq(emailMessage.organizationId, organizationId),
    eq(emailMessage.syncedByUserId, userId),
    provider === "google"
      ? isNotNull(emailMessage.gmailMessageId)
      : isNotNull(emailMessage.outlookMessageId),
  );
  const myEvents = and(
    eq(calendarEvent.organizationId, organizationId),
    eq(calendarEvent.syncedByUserId, userId),
  );
  const threadRows = await db
    .selectDistinct({ id: emailMessage.threadId })
    .from(emailMessage)
    .where(mine);
  const threadIds = threadRows.map((row) => row.id);
  const eventIds =
    provider === "google"
      ? (
          await db
            .select({ id: calendarEvent.id })
            .from(calendarEvent)
            .where(myEvents)
        ).map((row) => row.id)
      : [];

  const targets = await activityTargets(organizationId, threadIds, eventIds);

  const messages = await db
    .delete(emailMessage)
    .where(mine)
    .returning({ id: emailMessage.id });
  const events =
    provider === "google"
      ? await db
          .delete(calendarEvent)
          .where(myEvents)
          .returning({ id: calendarEvent.id })
      : [];

  for (const part of idChunks(threadIds)) {
    const inPart = and(
      eq(emailThread.organizationId, organizationId),
      inArray(emailThread.id, part),
    );
    await runBatch((tx) => [
      tx
        .delete(emailThread)
        .where(
          and(
            inPart,
            sql`not exists (select 1 from ${emailMessage} where ${emailMessage.threadId} = ${emailThread.id})`,
          ),
        ),
      tx
        .update(emailThread)
        .set({
          messageCount: sql`(select count(*) from ${emailMessage} where ${emailMessage.threadId} = ${emailThread.id})`,
          firstMessageAt: sql`(select min(${emailMessage.sentAt}) from ${emailMessage} where ${emailMessage.threadId} = ${emailThread.id})`,
          lastMessageAt: sql`(select max(${emailMessage.sentAt}) from ${emailMessage} where ${emailMessage.threadId} = ${emailThread.id})`,
          subject: sql`(select ${emailMessage.subject} from ${emailMessage} where ${emailMessage.threadId} = ${emailThread.id} order by ${emailMessage.sentAt} asc limit 1)`,
        })
        .where(inPart),
      tx
        .update(activity)
        .set({
          occurredAt: sql`(select max(${emailMessage.sentAt}) from ${emailMessage} where ${emailMessage.threadId} = ${activity.emailThreadId})`,
          body: sql`(select ${emailMessage.snippet} from ${emailMessage} where ${emailMessage.threadId} = ${activity.emailThreadId} order by ${emailMessage.sentAt} desc limit 1)`,
        })
        .where(
          and(
            eq(activity.organizationId, organizationId),
            inArray(activity.emailThreadId, part),
          ),
        ),
    ]);
  }

  return { purged: messages.length + events.length, targets };
}

/** The records the threads' and meetings' activities are about. */
async function activityTargets(
  organizationId: string,
  threadIds: string[],
  eventIds: string[],
): Promise<ActivityTargets> {
  const companyIds = new Set<string>();
  const contactIds = new Set<string>();
  const dealIds = new Set<string>();
  const groups = [
    [activity.emailThreadId, threadIds],
    [activity.calendarEventId, eventIds],
  ] as const;
  for (const [column, ids] of groups) {
    for (const part of idChunks(ids)) {
      const rows = await db
        .select({
          companyId: activity.companyId,
          contactId: activity.contactId,
          dealId: activity.dealId,
        })
        .from(activity)
        .where(
          and(
            eq(activity.organizationId, organizationId),
            inArray(column, part),
          ),
        );
      for (const row of rows) {
        if (row.companyId) companyIds.add(row.companyId);
        if (row.contactId) contactIds.add(row.contactId);
        if (row.dealId) dealIds.add(row.dealId);
      }
    }
  }
  return {
    companyIds: [...companyIds],
    contactIds: [...contactIds],
    dealIds: [...dealIds],
  };
}

export const SyncedDataRepository = { purgeSynced };
