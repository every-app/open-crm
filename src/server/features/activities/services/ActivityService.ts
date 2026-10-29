import type { EnsuredUserContext } from "@/middleware/ensure-user/types";
import { ActivityRepository } from "@/server/features/activities/repositories/ActivityRepository";
import type { ActivityEntry } from "@/server/features/activities/repositories/activityEntries";
import { CaptureRepository } from "@/server/features/activities/repositories/CaptureRepository";
import { ArchiveRepository } from "@/server/features/archive/repositories/ArchiveRepository";
import { blankToNull } from "@/server/features/records/recordRules";
import { AppError } from "@/server/lib/errors";
import { hasOrgPermission } from "@/shared/org-permissions";
import type { RecordRef } from "@/shared/records";
import {
  COMPOSABLE_TYPES,
  type CreateActivityInput,
  type MyTasksInput,
  type TimelineInput,
  type UpdateActivityInput,
} from "@/types/schemas/activities";

// What happened on a company, contact or deal, and the tasks people set
// themselves. Anyone in the organization may log an activity on any of its
// records and tick off any of its tasks, as in the CRM. An activity on a
// contact or a deal is filed under their company too, so the company's
// timeline tells the whole account's story. What a person logged is theirs
// to change or delete, and any of it an owner's or admin's; captured mail
// and meetings, stage changes and automated entries stay as they are.

type Actor = Pick<EnsuredUserContext, "organizationId" | "userId" | "role">;

const LOGGED_TYPES = new Set<string>(COMPOSABLE_TYPES);

async function requireRecord(organizationId: string, record: RecordRef) {
  const found = await ActivityRepository.recordCompany(organizationId, record);
  if (!found) {
    throw new AppError("NOT_FOUND", `No ${record.kind} with id ${record.id}.`);
  }
  return found;
}

async function requireEntry(
  organizationId: string,
  id: string,
): Promise<ActivityEntry> {
  const entry = await ActivityRepository.findById(organizationId, id);
  if (!entry) throw new AppError("NOT_FOUND", `No activity with id ${id}.`);
  return entry;
}

/** A page of a record's timeline, newest first. */
async function timeline(organizationId: string, input: TimelineInput) {
  await requireRecord(organizationId, input.record);
  return ActivityRepository.timeline(organizationId, input);
}

/** How many entries each of a record's timeline views has. */
async function timelineCounts(organizationId: string, record: RecordRef) {
  await requireRecord(organizationId, record);
  return ActivityRepository.counts(organizationId, record);
}

/**
 * Logs a note, call, email, meeting or task by `userId`. Every record named
 * must be the organization's. The company it is filed under is the one
 * named, else the deal's, else the contact's.
 */
async function createActivity(
  organizationId: string,
  userId: string,
  input: CreateActivityInput,
): Promise<ActivityEntry> {
  const [contact, deal] = await Promise.all([
    input.contactId
      ? requireRecord(organizationId, { kind: "contact", id: input.contactId })
      : null,
    input.dealId
      ? requireRecord(organizationId, { kind: "deal", id: input.dealId })
      : null,
    input.companyId
      ? requireRecord(organizationId, { kind: "company", id: input.companyId })
      : null,
  ]);
  const isTask = input.type === "TASK";
  const id = await ActivityRepository.insert({
    organizationId,
    type: input.type,
    subject: blankToNull(input.subject ?? ""),
    body: blankToNull(input.body ?? ""),
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    dueAt: isTask ? (input.dueAt ?? null) : null,
    companyId: input.companyId ?? deal?.companyId ?? contact?.companyId ?? null,
    contactId: input.contactId ?? null,
    dealId: input.dealId ?? null,
    createdById: userId,
  });
  console.log("[activities] logged", {
    organizationId,
    activityId: id,
    type: input.type,
  });
  return requireEntry(organizationId, id);
}

/** Ticks a task off, or opens it again. Only a task can be completed. */
async function completeTask(
  organizationId: string,
  id: string,
  completed: boolean,
): Promise<ActivityEntry> {
  const changed = await ActivityRepository.setCompleted(
    organizationId,
    id,
    completed ? new Date().toISOString() : null,
  );
  if (!changed) {
    await requireEntry(organizationId, id);
    throw new AppError("VALIDATION_ERROR", "Only tasks can be completed.");
  }
  return requireEntry(organizationId, id);
}

/** An activity a person logged that `actor` may change or delete. */
async function requireOwnEntry(actor: Actor, id: string) {
  const entry = await requireEntry(actor.organizationId, id);
  if (
    !entry.createdBy ||
    entry.emailThread ||
    entry.calendarEvent ||
    !LOGGED_TYPES.has(entry.type)
  ) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Only notes, calls, emails, meetings and tasks a person logged can be changed or deleted.",
    );
  }
  if (
    entry.createdBy.id !== actor.userId &&
    !hasOrgPermission(actor.role, { record: ["purge"] })
  ) {
    throw new AppError(
      "FORBIDDEN",
      "Only the person who logged it, an owner or an admin can change or delete it.",
    );
  }
  return entry;
}

/** Changes what an activity says or when; only what is given changes. */
async function updateActivity(
  actor: Actor,
  input: UpdateActivityInput,
): Promise<ActivityEntry> {
  const entry = await requireOwnEntry(actor, input.id);
  const isTask = entry.type === "TASK";
  const subject =
    input.subject === undefined ? entry.subject : blankToNull(input.subject);
  const body = input.body === undefined ? entry.body : blankToNull(input.body);
  if (isTask ? !subject : !subject && !body) {
    throw new AppError(
      "VALIDATION_ERROR",
      isTask
        ? "A task needs a subject: it is the thing to do."
        : "Say what happened.",
    );
  }
  await ActivityRepository.update(actor.organizationId, entry.id, {
    subject,
    body,
    ...(input.occurredAt !== undefined && { occurredAt: input.occurredAt }),
    ...(isTask && input.dueAt !== undefined && { dueAt: input.dueAt }),
  });
  return requireEntry(actor.organizationId, entry.id);
}

/** Deletes an activity for good; its records' last activity moves back. */
async function deleteActivity(actor: Actor, id: string) {
  const entry = await requireOwnEntry(actor, id);
  await ActivityRepository.remove(actor.organizationId, entry.id);
  await ArchiveRepository.restamp(actor.organizationId, {
    companyIds: entry.company ? [entry.company.id] : [],
    contactIds: entry.contact ? [entry.contact.id] : [],
    dealIds: entry.deal ? [entry.deal.id] : [],
  });
  console.log("[activities] deleted", {
    organizationId: actor.organizationId,
    activityId: entry.id,
  });
  return { id: entry.id };
}

/** The open tasks `userId` set themselves, soonest due first. */
function myTasks(organizationId: string, userId: string, input: MyTasksInput) {
  return ActivityRepository.openTasks(organizationId, {
    userId,
    window: input.window,
    limit: input.limit,
    now: new Date().toISOString(),
  });
}

/** A captured email thread's messages, for its timeline entry. */
async function emailThread(organizationId: string, id: string) {
  const thread = await CaptureRepository.thread(organizationId, id);
  if (!thread)
    throw new AppError("NOT_FOUND", `No email thread with id ${id}.`);
  return thread;
}

/** A captured meeting's attendees, for its timeline entry. */
async function meeting(organizationId: string, id: string) {
  const found = await CaptureRepository.meeting(organizationId, id);
  if (!found) throw new AppError("NOT_FOUND", `No meeting with id ${id}.`);
  return found;
}

export const ActivityService = {
  timeline,
  timelineCounts,
  createActivity,
  updateActivity,
  deleteActivity,
  completeTask,
  myTasks,
  emailThread,
  meeting,
};
