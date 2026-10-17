import { z } from "zod";
import { crmTool } from "@/server/everyapp/crm-tool";
import type { ActivityEntry } from "@/server/features/activities/repositories/activityEntries";
import { ActivityService } from "@/server/features/activities/services/ActivityService";
import { AppError } from "@/server/lib/errors";
import { RECORD_KINDS } from "@/shared/records";
import {
  ACTIVITY_BODY_MAX,
  ACTIVITY_SUBJECT_MAX,
  COMPOSABLE_TYPES,
  TASK_WINDOWS,
  createActivitySchema,
} from "@/types/schemas/activities";

// The timeline as an AI client sees it: what happened on a record, logging
// a note, call, email, meeting or task, and the caller's own tasks.

function fullName(person: { firstName: string; lastName: string | null }) {
  return [person.firstName, person.lastName].filter(Boolean).join(" ");
}

const stageChange = z
  .object({ from: z.string(), to: z.string() })
  .nullable()
  .catch(null);

/** An activity as a model reads it: people by name, records by id and name. */
export function toolActivity(entry: ActivityEntry) {
  return {
    id: entry.id,
    type: entry.type,
    subject: entry.subject,
    body: entry.body,
    occurredAt: entry.occurredAt,
    dueAt: entry.dueAt,
    completedAt: entry.completedAt,
    createdAt: entry.createdAt,
    // Null when the research agent wrote it.
    author: entry.createdBy
      ? { name: entry.createdBy.name, email: entry.createdBy.email }
      : null,
    company: entry.company,
    contact: entry.contact
      ? { id: entry.contact.id, name: fullName(entry.contact) }
      : null,
    deal: entry.deal,
    stageChange:
      entry.type === "STAGE_CHANGE" ? stageChange.parse(entry.meta) : null,
    email: entry.emailThread
      ? { messages: entry.emailThread.messageCount }
      : null,
    meeting: entry.calendarEvent
      ? {
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

export const activityTools = {
  list_activities: crmTool({
    description:
      "A company's, contact's or deal's timeline, newest first: notes, calls, emails, meetings, tasks, deal stage changes and what the research agent found. A company's timeline includes what was logged on its people and deals. `filter` narrows it: notes (notes, calls, emails and meetings), upcoming (open tasks), done (finished tasks), email or meetings. 30 a page; pass the previous page's nextCursor for older entries.",
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
          .optional(),
        cursor: z
          .string()
          .max(200)
          .optional()
          .describe("The nextCursor of the page before."),
      })
      .strict(),
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
      "Log a note, call, email, meeting or task on a company, a contact and/or a deal (at least one). What is logged on a contact or a deal is filed under their company too, and moves each record's last activity. A task needs a subject (the thing to do) and may have a due date; anything else needs a subject or a body.",
    risk: "write",
    input: z
      .object({
        type: z.enum(COMPOSABLE_TYPES),
        subject: z
          .string()
          .max(ACTIVITY_SUBJECT_MAX)
          .optional()
          .describe("A task's thing to do, or a short title."),
        body: z
          .string()
          .max(ACTIVITY_BODY_MAX)
          .optional()
          .describe("What was said, decided or promised."),
        occurredAt: z
          .string()
          .optional()
          .describe("When it happened, ISO 8601. Now unless given."),
        dueAt: z
          .string()
          .optional()
          .describe("When a task is due, ISO 8601, e.g. 2026-10-20T17:00:00Z."),
        companyId: recordId("company"),
        contactId: recordId("contact"),
        dealId: recordId("deal"),
      })
      .strict(),
    handler: async (input, context) => {
      const parsed = createActivitySchema.safeParse(input);
      if (!parsed.success) {
        throw new AppError(
          "VALIDATION_ERROR",
          parsed.error.issues.map((issue) => issue.message).join(" "),
        );
      }
      return toolActivity(
        await ActivityService.createActivity(
          context.organizationId,
          context.userId,
          parsed.data,
        ),
      );
    },
  }),

  complete_task: crmTool({
    description:
      "Tick off a task, or open it again with completed: false. Only a task can be completed; its id comes from list_my_tasks or list_activities.",
    risk: "write",
    input: z
      .object({
        id: z.string().min(1).describe("The task's id."),
        completed: z.boolean().optional(),
      })
      .strict(),
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
      "The caller's open tasks (the ones they set), soonest due first and undated ones last: all of them, the overdue ones, or the upcoming ones. At most 100.",
    risk: "read",
    input: z.object({ window: z.enum(TASK_WINDOWS).optional() }).strict(),
    handler: async ({ window }, context) => ({
      tasks: (
        await ActivityService.myTasks(context.organizationId, context.userId, {
          window: window ?? "all",
          limit: 100,
        })
      ).map(toolActivity),
    }),
  }),
};
