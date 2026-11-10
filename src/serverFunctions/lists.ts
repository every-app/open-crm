import { createServerFn } from "@tanstack/react-start";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { ListService } from "@/server/features/lists/services/ListService";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";
import {
  addMatchingToListSchema,
  addToListSchema,
  createListSchema,
  listEntriesSchema,
  listIdSchema,
  listListsSchema,
  recordListsSchema,
  removeFromListSchema,
  saveListSchema,
  setListStageSchema,
} from "@/types/schemas/lists";

// Lists are the whole team's: members make, change and archive them and
// work people through them. Deleting one for good (its stages and who was
// in it, never the records) is for owners and admins.

export const listLists = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .validator(listListsSchema)
  .handler(({ data, context }) =>
    ListService.listLists(context.organizationId, data),
  );

export const createList = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(createListSchema)
  .handler(({ data, context }) =>
    ListService.createList(context.organizationId, context.userId, data),
  );

export const updateList = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(saveListSchema)
  .handler(({ data, context }) =>
    ListService.updateList(context.organizationId, data),
  );

export const deleteList = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(listIdSchema)
  .handler(({ data, context }) => {
    requireOrgPermission(context, { record: ["purge"] });
    return ListService.deleteList(context.organizationId, data.id);
  });

export const addToList = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(addToListSchema)
  .handler(({ data, context }) =>
    ListService.addToList(context.organizationId, context.userId, data),
  );

export const addMatchingToList = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(addMatchingToListSchema)
  .handler(({ data, context }) =>
    ListService.addMatchingToList(context.organizationId, context.userId, data),
  );

export const removeFromList = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(removeFromListSchema)
  .handler(({ data, context }) =>
    ListService.removeFromList(context.organizationId, data),
  );

export const setListStage = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(setListStageSchema)
  .handler(({ data, context }) =>
    ListService.setStage(context.organizationId, context.userId, data),
  );

export const listEntries = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .validator(listEntriesSchema)
  .handler(({ data, context }) =>
    ListService.listEntries(context.organizationId, data),
  );

export const getRecordLists = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .validator(recordListsSchema)
  .handler(({ data, context }) =>
    ListService.recordLists(context.organizationId, data.entity, data.id),
  );
