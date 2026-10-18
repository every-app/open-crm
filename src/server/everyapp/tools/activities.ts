import { z } from "zod";
import {
  crmTool,
  fullName,
  personOutput,
  recordRefOutput,
} from "@/server/everyapp/crm-tool";
import type { ActivityEntry } from "@/server/features/activities/repositories/activityEntries";
import { ActivityService } from "@/server/features/activities/services/ActivityService";
import { AppError } from "@/server/lib/errors";
import { ACTIVITY_TYPES } from "@/shared/crm-enums";
import { RECORD_KINDS } from "@/shared/records";
import {
  ACTIVITY_BODY_MAX,
  ACTIVITY_SUBJECT_MAX,
  COMPOSABLE_TYPES,
  TASK_WINDOWS,
  createActivitySchema,
  updateActivitySchema,
} from "@/types/schemas/activities";

// The timeline as an AI client sees it: what happened on a record, logging,
// changing and deleting a note, call, email, meeting or task, the caller's
// own tasks, and the captured mail and meetings behind EMAIL and MEETING
// entries (mail.ts reads those).

const stageChange = z
  .object({ from: z.string(), to: z.string() })
  .nullable()
  .catch(null);

export const activityOutput = z.object({
  id: z.string(),
  type: z.enum(ACTIVITY_TYPES),
  subject: z.string().nullable(),
  body: z.string().nullable(),
  occurredAt: z.string().nullable(),
  dueAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  author: personOutput
    .nullable()
    .describe("Who logged it; null when the research agent or a form did."),
  company: recordRefOutput.nullable(),
  contact: recordRefOutput.nullable(),
  deal: recordRefOutput.nullable(),
  stageChange: z.object({ from: z.string(), to: z.string() }).nullable(),
  email: z
    .object({ threadId: z.string(), messages: z.number() })
    .nullable()
    .describe("A captured email thread: get_email_thread reads it."),
  meeting: z
    .object({
      meetingId: z.string(),
      startsAt: z.string(),
      endsAt: z.string(),
      isAllDay: z.boolean(),
      location: z.string().nullable(),
      attendees: z.number(),
    })
    .nullable()
    .describe("A captured meeting: get_meeting lists who attended."),
});

/** An activity as a model reads it: people by name, records by id and name. */
export function toolActivity(
  entry: ActivityEntry,
): z.input<typeof activityOutput> {
  return {
    ...entry,
    author: entry.createdBy,
    contact: entry.contact
      ? { id: entry.contact.id, name: fullName(entry.contact) }
      : null,
    stageChange:
      entry.type === "STAGE_CHANGE" ? stageChange.parse(entry.meta) : null,
    email: entry.emailThread
      ? {
          threadId: entry.emailThread.id,
          messages: entry.emailThread.messageCount,
        }
      : null,
    meeting: entry.calendarEvent
      ? {
          meetingId: entry.calendarEvent.id,
          startsAt: entry.calendarEvent.startsAt,
          endsAt: entry.calendarEvent.endsAt,
          isAllDay: entry.calendarEvent.isAllDay,
          location: entry.calendarEvent.location,
          attendees: entry.calendarEvent.attendeeCount,
        }
      : null,
  };
}

const recordId = (kind: string) =>
  z
    .string()
    .min(1)
    .optional()
    .describe(`The ${kind}'s id, from search_records or the list tools.`);

const activityId = z
  .string()
  .min(1)
  .describe("The activity's id, from list_activities or list_my_tasks.");

const subject = z
  .string()
  .max(ACTIVITY_SUBJECT_MAX)
  .describe("A task's thing to do, or a short title.");

const body = z
  .string()
  .max(ACTIVITY_BODY_MAX)
  .describe("What was said, decided or promised.");

const dueAt = z
  .string()
  .describe("When a task is due, ISO 8601, e.g. 2026-10-20T17:00:00Z.");

/** A schema's refusal as one readable message. */
function parsed<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AppError(
      "VALIDATION_ERROR",
      result.error.issues.map((issue) => issue.message).join(" "),
    );
  }
  return result.data;
}

export const activityTools = {
  list_activities: crmTool({
    description:
      "A company's, contact's or deal's timeline, newest first: notes, calls, emails, meetings, tasks, stage changes and the research agent's findings. A company's includes its people's and deals'. Filter `email` or `meetings` for captured mail and meetings. 30 a page; pass nextCursor for older entries.",
    risk: "read",
    input: z
      .object({
        kind: z.enum(RECORD_KINDS),
        id: z
          .string()
          .min(1)
          .describe("The record's id, from search_records or the list tools."),
        filter: z
          .enum(["all", "notes", "upcoming", "done", "email", "meetings"])
          .optional()
          .describe(
            "notes: notes, calls, emails and meetings people logged; upcoming: open tasks; done: finished tasks; email and meetings: captured ones.",
          ),
        cursor: z
          .string()
          .max(200)
          .optional()
          .describe("The nextCursor of the page before."),
      })
      .strict(),
    output: z.object({
      activities: z.array(activityOutput),
      nextCursor: z.string().nullable(),
    }),
    handler: async ({ kind, id, filter, cursor }, context) => {
      const page = await ActivityService.timeline(context.organizationId, {
        record: { kind, id },
        filter: filter ?? "all",
        cursor: cursor || undefined,
        limit: 30,
      });
      return {
        activities: page.entries.map(toolActivity),
        nextCursor: page.nextCursor,
      };
    },
  }),

  log_activity: crmTool({
    description:
      "Log a note, call, email, meeting or task on a company, contact and/or deal (at least one). What's logged on a contact or deal is filed under their company too. A task needs a subject and may have a due date; anything else needs a subject or a body.",
    risk: "write",
    input: z
      .object({
        type: z.enum(COMPOSABLE_TYPES),
        subject: subject.optional(),
        body: body.optional(),
        occurredAt: z
          .string()
          .optional()
          .describe("When it happened, ISO 8601. Now unless given."),
        dueAt: dueAt.optional(),
        companyId: recordId("company"),
        contactId: recordId("contact"),
        dealId: recordId("deal"),
      })
      .strict(),
    output: activityOutput,
    handler: async (input, context) =>
      toolActivity(
        await ActivityService.createActivity(
          context.organizationId,
          context.userId,
          parsed(createActivitySchema, input),
        ),
      ),
  }),

  update_activity: crmTool({
    description:
      "Change a note, call, email, meeting or task a person logged: its subject, body, when it happened or a task's due date. Only fields given change; null clears a due date. Its author, an owner or an admin may; captured mail and meetings can't be changed.",
    risk: "write",
    input: z
      .object({
        id: activityId,
        subject: subject.optional(),
        body: body.optional(),
        occurredAt: z
          .string()
          .optional()
          .describe("When it happened, ISO 8601."),
        dueAt: dueAt.nullable().optional(),
      })
      .strict(),
    output: activityOutput,
    handler: async (input, context) =>
      toolActivity(
        await ActivityService.updateActivity(
          context,
          parsed(updateActivitySchema, input),
        ),
      ),
  }),

  delete_activity: crmTool({
    description:
      "Delete a note, call, email, meeting or task a person logged, for good. Its author, an owner or an admin may; captured mail and meetings can't be deleted.",
    risk: "destructive",
    input: z.object({ id: activityId }).strict(),
    output: z.object({ id: z.string() }),
    handler: ({ id }, context) => ActivityService.deleteActivity(context, id),
  }),

  complete_task: crmTool({
    description:
      "Tick off a task, or open it again with completed: false. Only tasks can be completed.",
    risk: "write",
    input: z
      .object({
        id: z.string().min(1).describe("The task's id."),
        completed: z.boolean().optional(),
      })
      .strict(),
    output: activityOutput,
    handler: async ({ id, completed }, context) =>
      toolActivity(
        await ActivityService.completeTask(
          context.organizationId,
          id,
          completed ?? true,
        ),
      ),
  }),

  list_my_tasks: crmTool({
    description:
      "The caller's open tasks, soonest due first and undated last: all, overdue or upcoming. 25 unless `limit` says (at most 100).",
    risk: "read",
    input: z
      .object({
        window: z.enum(TASK_WINDOWS).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      })
      .strict(),
    output: z.object({ tasks: z.array(activityOutput) }),
    handler: async ({ window, limit }, context) => ({
      tasks: (
        await ActivityService.myTasks(context.organizationId, context.userId, {
          window: window ?? "all",
          limit: limit ?? 25,
        })
      ).map(toolActivity),
    }),
  }),
};
