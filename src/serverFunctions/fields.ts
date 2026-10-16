import { createServerFn } from "@tanstack/react-start";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { FieldsService } from "@/server/features/fields/services/FieldsService";
import { FieldValuesService } from "@/server/features/fields/services/FieldValuesService";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";
import {
  createFieldSchema,
  fieldIdSchema,
  listFieldsSchema,
  recordFieldsSchema,
  reorderFieldsSchema,
  setRecordFieldValuesSchema,
  updateFieldSchema,
} from "@/types/schemas/fields";

// Everyone reads the fields and edits the values on records; owners and admins
// add, change, reorder, archive and delete fields and ask the agent to fill
// them (`field: ["manage"]`).

export const listFields = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .validator(listFieldsSchema)
  .handler(({ data, context }) =>
    FieldsService.list(context.organizationId, data.entity, {
      includeArchived: data.includeArchived,
    }),
  );

export const createField = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(createFieldSchema)
  .handler(({ data, context }) => {
    requireOrgPermission(context, { field: ["manage"] });
    return FieldsService.create(context.organizationId, data);
  });

export const updateField = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(updateFieldSchema)
  .handler(({ data, context }) => {
    requireOrgPermission(context, { field: ["manage"] });
    return FieldsService.update(context.organizationId, data);
  });

export const reorderFields = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(reorderFieldsSchema)
  .handler(({ data, context }) => {
    requireOrgPermission(context, { field: ["manage"] });
    return FieldsService.reorder(context.organizationId, data.entity, data.ids);
  });

export const archiveField = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(fieldIdSchema)
  .handler(({ data, context }) => {
    requireOrgPermission(context, { field: ["manage"] });
    return FieldsService.archive(context.organizationId, data.id);
  });

export const restoreField = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(fieldIdSchema)
  .handler(({ data, context }) => {
    requireOrgPermission(context, { field: ["manage"] });
    return FieldsService.restore(context.organizationId, data.id);
  });

export const deleteField = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(fieldIdSchema)
  .handler(({ data, context }) => {
    requireOrgPermission(context, { field: ["manage"] });
    return FieldsService.remove(context.organizationId, data.id);
  });

export const getFieldCoverage = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .validator(fieldIdSchema)
  .handler(({ data, context }) =>
    FieldsService.coverage(context.organizationId, data.id),
  );

/** "Ask the agent to fill": the agent's research costs the organization. */
export const fillField = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(fieldIdSchema)
  .handler(({ data, context }) => {
    requireOrgPermission(context, { field: ["manage"] });
    return FieldsService.fill(context.organizationId, data.id);
  });

export const getRecordFields = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .validator(recordFieldsSchema)
  .handler(({ data, context }) =>
    FieldValuesService.recordFields(
      context.organizationId,
      data.entity,
      data.recordId,
    ),
  );

export const setRecordFieldValues = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(setRecordFieldValuesSchema)
  .handler(({ data, context }) =>
    FieldValuesService.setValues(
      context.organizationId,
      data.entity,
      data.recordId,
      data.values,
    ),
  );
