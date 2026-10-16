import { queryOptions } from "@tanstack/react-query";
import {
  getFieldCoverage,
  getRecordFields,
  listFields,
} from "@/serverFunctions/fields";
import type { FieldEntity } from "@/shared/crm-enums";

/**
 * Every fields query of an entity starts with this key: a change to a field
 * definition invalidates its lists, its records' values and its coverage.
 */
export const entityFieldsKey = (entity: FieldEntity) =>
  ["fields", entity] as const;

/** An entity's fields in sheet order; archived ones only when asked for. */
export const fieldsQueryOptions = (
  entity: FieldEntity,
  includeArchived = false,
) =>
  queryOptions({
    queryKey: [...entityFieldsKey(entity), "list", { includeArchived }],
    queryFn: () => listFields({ data: { entity, includeArchived } }),
  });

/** One record's fields, each with its value. */
export const recordFieldsQueryOptions = (
  entity: FieldEntity,
  recordId: string,
) =>
  queryOptions({
    queryKey: [...entityFieldsKey(entity), "record", recordId],
    queryFn: () => getRecordFields({ data: { entity, recordId } }),
  });

/** How many live records have the field filled, of how many. */
export const fieldCoverageQueryOptions = (entity: FieldEntity, id: string) =>
  queryOptions({
    queryKey: [...entityFieldsKey(entity), "coverage", id],
    queryFn: () => getFieldCoverage({ data: { id } }),
  });
