import { createServerFn } from "@tanstack/react-start";
import { SavedViewService } from "@/server/features/saved-views/services/SavedViewService";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";
import {
  createSavedViewSchema,
  listSavedViewsSchema,
  savedViewIdSchema,
  updateSavedViewSchema,
} from "@/types/schemas/saved-views";

// Saved views are personal until their owner shares them; only the owner
// changes or deletes one, whatever their role.

export const listSavedViews = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .validator(listSavedViewsSchema)
  .handler(({ data, context }) =>
    SavedViewService.list(context.organizationId, context.userId, data.entity),
  );

export const createSavedView = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(createSavedViewSchema)
  .handler(({ data, context }) =>
    SavedViewService.create(context.organizationId, context.userId, data),
  );

export const updateSavedView = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(updateSavedViewSchema)
  .handler(({ data, context }) =>
    SavedViewService.update(context.organizationId, context.userId, data),
  );

export const deleteSavedView = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(savedViewIdSchema)
  .handler(({ data, context }) =>
    SavedViewService.remove(context.organizationId, context.userId, data.id),
  );
