import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { companyKeys } from "@/client/features/companies/companyQueries";
import { contactKeys } from "@/client/features/contacts/contactQueries";
import { dealKeys } from "@/client/features/deals/dealQueries";
import {
  getFieldCoverage,
  getRecordFields,
  listFields,
} from "@/serverFunctions/fields";
import type { FieldEntity } from "@/shared/crm-enums";
import type { RecordKind } from "@/shared/records";

/** Whose custom fields a kind of record has. */
export const ENTITY_OF_KIND: Record<RecordKind, FieldEntity> = {
  company: "COMPANY",
  contact: "CONTACT",
  deal: "DEAL",
};

/**
 * Every fields query of an entity starts with this key: a change to a field
 * definition invalidates its lists, its records' values and its coverage.
 */
export const entityFieldsKey = (entity: FieldEntity) =>
  ["fields", entity] as const;

/**
 * The entity's record lists: their rows carry the values of the fields
 * shown as columns, and their filters name fields.
 */
export const recordListsKey = (entity: FieldEntity) =>
  ({
    COMPANY: companyKeys.lists,
    CONTACT: contactKeys.lists,
    DEAL: dealKeys.lists,
  })[entity];

/**
 * After a field definition changes: its fields queries refetch, and the
 * entity's lists behind them (the fields sheet needn't wait for those).
 */
export function settleEntityFields(
  queryClient: QueryClient,
  entity: FieldEntity,
): Promise<void> {
  void queryClient.invalidateQueries({ queryKey: recordListsKey(entity) });
  return queryClient.invalidateQueries({ queryKey: entityFieldsKey(entity) });
}

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
