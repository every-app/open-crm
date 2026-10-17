import { z } from "zod";
import { apiRoute } from "@/server/api/apiRoute";
import { ActivityService } from "@/server/features/activities/services/ActivityService";
import type { RecordRef } from "@/shared/records";
import {
  completeTaskSchema,
  createActivitySchema,
  myTasksSchema,
  timelineSchema,
} from "@/types/schemas/activities";

// As in src/serverFunctions/activities.ts: every member logs activities on
// any of the organization's records and ticks off any of its tasks.

const tag = "Activities";

// A timeline is a record's, named in the query string by the record's id as
// the original API took it: ?companyId=, ?contactId= or ?dealId=.
const recordQuery = z.object({
  companyId: z.string().min(1).optional(),
  contactId: z.string().min(1).optional(),
  dealId: z.string().min(1).optional(),
});

const exactlyOneRecord = {
  check: (query: z.infer<typeof recordQuery>) =>
    [query.companyId, query.contactId, query.dealId].filter(Boolean).length ===
    1,
  message: "Name one record: companyId, contactId or dealId.",
};

function recordOf(query: z.infer<typeof recordQuery>): RecordRef {
  if (query.companyId) return { kind: "company", id: query.companyId };
  if (query.contactId) return { kind: "contact", id: query.contactId };
  return { kind: "deal", id: query.dealId ?? "" };
}

export const activityRoutes = [
  apiRoute({
    method: "GET",
    path: "/activities",
    tag,
    summary:
      "A record's timeline, newest first, a page at a time: pass the page's nextCursor as cursor for the next.",
    input: timelineSchema
      .omit({ record: true })
      .extend(recordQuery.shape)
      .refine(exactlyOneRecord.check, exactlyOneRecord.message),
    handler: ({ companyId, contactId, dealId, ...rest }, context) =>
      ActivityService.timeline(context.organizationId, {
        ...rest,
        record: recordOf({ companyId, contactId, dealId }),
      }),
  }),
  apiRoute({
    method: "GET",
    path: "/activities/counts",
    tag,
    summary: "How many entries each of a record's timeline views has.",
    input: recordQuery.refine(exactlyOneRecord.check, exactlyOneRecord.message),
    handler: (data, context) =>
      ActivityService.timelineCounts(context.organizationId, recordOf(data)),
  }),
  apiRoute({
    method: "GET",
    path: "/activities/my-tasks",
    tag,
    summary:
      "The caller's open tasks: all of them, the overdue ones, or the ones still to come.",
    input: myTasksSchema,
    handler: (data, context) =>
      ActivityService.myTasks(context.organizationId, context.userId, data),
  }),
  apiRoute({
    method: "POST",
    path: "/activities",
    tag,
    summary:
      "Log a note, call, email, meeting or task on a company, contact or deal. A task needs a subject and may have a dueAt.",
    input: createActivitySchema,
    handler: (data, context) =>
      ActivityService.createActivity(
        context.organizationId,
        context.userId,
        data,
      ),
  }),
  apiRoute({
    method: "PATCH",
    path: "/activities/{id}/complete",
    tag,
    summary: "Complete a task, or open it again with completed: false.",
    input: completeTaskSchema,
    handler: (data, context) =>
      ActivityService.completeTask(
        context.organizationId,
        data.id,
        data.completed,
      ),
  }),
];
