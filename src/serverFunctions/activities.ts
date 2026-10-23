import { createServerFn } from "@tanstack/react-start";
import { ActivityService } from "@/server/features/activities/services/ActivityService";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";
import {
  capturedIdSchema,
  completeTaskSchema,
  createActivitySchema,
  timelineSchema,
} from "@/types/schemas/activities";

// Every member works the timeline: they log activities on any of the
// organization's records and tick off any of its tasks.

export const getTimeline = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .validator(timelineSchema)
  .handler(({ data, context }) =>
    ActivityService.timeline(context.organizationId, data),
  );

export const createActivity = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(createActivitySchema)
  .handler(({ data, context }) =>
    ActivityService.createActivity(
      context.organizationId,
      context.userId,
      data,
    ),
  );

export const completeTask = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(completeTaskSchema)
  .handler(({ data, context }) =>
    ActivityService.completeTask(
      context.organizationId,
      data.id,
      data.completed,
    ),
  );

export const getEmailThread = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .validator(capturedIdSchema)
  .handler(({ data, context }) =>
    ActivityService.emailThread(context.organizationId, data.id),
  );

export const getMeeting = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .validator(capturedIdSchema)
  .handler(({ data, context }) =>
    ActivityService.meeting(context.organizationId, data.id),
  );
