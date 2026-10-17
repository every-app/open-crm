import { z } from "zod";
import { RECORD_KINDS } from "@/shared/records";

// The timeline: what happened on a company, contact or deal (notes, calls,
// emails, meetings, tasks, stage changes, the agent's findings), and the
// tasks people set themselves.

/** What a person logs from a record's timeline. */
export const COMPOSABLE_TYPES = [
  "NOTE",
  "CALL",
  "EMAIL",
  "MEETING",
  "TASK",
] as const;
export type ComposableType = (typeof COMPOSABLE_TYPES)[number];

/**
 * A timeline's views. `history` is everything but open tasks: the All tab
 * shows those pinned above it.
 */
export const TIMELINE_FILTERS = [
  "all",
  "history",
  "notes",
  "upcoming",
  "done",
  "email",
  "meetings",
] as const;
export type TimelineFilter = (typeof TIMELINE_FILTERS)[number];

/** My tasks: every open one, the overdue ones, or the ones still to come. */
export const TASK_WINDOWS = ["all", "overdue", "upcoming"] as const;
export type TaskWindow = (typeof TASK_WINDOWS)[number];

export const ACTIVITY_SUBJECT_MAX = 500;
export const ACTIVITY_BODY_MAX = 20_000;

/** The record a timeline belongs to. */
const recordRefSchema = z.object({
  kind: z.enum(RECORD_KINDS),
  id: z.string().min(1),
});

/** A moment any date parser reads, stored as ISO 8601 UTC. */
const instant = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .transform((value, context) => {
    const time = Date.parse(value);
    if (Number.isNaN(time)) {
      context.addIssue({
        code: "custom",
        message: `"${value}" is not a date.`,
      });
      return z.NEVER;
    }
    return new Date(time).toISOString();
  });

export const timelineSchema = z.object({
  record: recordRefSchema,
  filter: z.enum(TIMELINE_FILTERS).default("all"),
  /** The `nextCursor` of the page before. */
  cursor: z
    .string()
    .max(200)
    .regex(/^[^|]+\|[^|]+$/)
    .optional(),
  limit: z.number().int().min(1).max(100).default(30),
});

export type TimelineInput = z.infer<typeof timelineSchema>;

export const timelineCountsSchema = z.object({ record: recordRefSchema });

export const createActivitySchema = z
  .object({
    type: z.enum(COMPOSABLE_TYPES),
    subject: z.string().trim().max(ACTIVITY_SUBJECT_MAX).optional(),
    body: z.string().trim().max(ACTIVITY_BODY_MAX).optional(),
    /** When it happened; now unless said. */
    occurredAt: instant.optional(),
    /** When a task is due; ignored for anything else. */
    dueAt: instant.nullable().optional(),
    companyId: z.string().min(1).optional(),
    contactId: z.string().min(1).optional(),
    dealId: z.string().min(1).optional(),
  })
  .refine((input) => input.companyId || input.contactId || input.dealId, {
    message: "An activity has to be about a company, a contact or a deal.",
  })
  .refine((input) => input.type !== "TASK" || Boolean(input.subject), {
    message: "A task needs a subject: it is the thing to do.",
    path: ["subject"],
  })
  .refine(
    (input) => input.type === "TASK" || Boolean(input.subject || input.body),
    { message: "Say what happened.", path: ["body"] },
  );

export type CreateActivityInput = z.infer<typeof createActivitySchema>;

export const completeTaskSchema = z.object({
  id: z.string().min(1),
  /** False opens a finished task again. */
  completed: z.boolean().default(true),
});

export const myTasksSchema = z.object({
  window: z.enum(TASK_WINDOWS).default("all"),
  limit: z.number().int().min(1).max(100).default(25),
});

export type MyTasksInput = z.infer<typeof myTasksSchema>;

export const capturedIdSchema = z.object({ id: z.string().min(1) });
