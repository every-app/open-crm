import {
  and,
  count,
  eq,
  inArray,
  isNotNull,
  or,
  type SQLWrapper,
} from "drizzle-orm";
import { db } from "@/db";
import { fieldValue } from "@/db/schema";
import type { FieldEntity } from "@/shared/crm-enums";

// What a list's filters on select and user fields count.

function recordColumn(entity: FieldEntity) {
  switch (entity) {
    case "COMPANY":
      return fieldValue.companyId;
    case "CONTACT":
      return fieldValue.contactId;
    case "DEAL":
      return fieldValue.dealId;
  }
}

/**
 * How many of the records `inScope` (a query of a list's record ids) hold
 * each option of each select field and each member of each user field.
 */
async function choiceCounts(
  organizationId: string,
  entity: FieldEntity,
  inScope: SQLWrapper,
) {
  return db
    .select({
      fieldId: fieldValue.fieldId,
      optionId: fieldValue.optionId,
      userId: fieldValue.userId,
      count: count(),
    })
    .from(fieldValue)
    .where(
      and(
        eq(fieldValue.organizationId, organizationId),
        inArray(recordColumn(entity), inScope),
        or(isNotNull(fieldValue.optionId), isNotNull(fieldValue.userId)),
      ),
    )
    .groupBy(fieldValue.fieldId, fieldValue.optionId, fieldValue.userId);
}

export const FieldFacetRepository = { choiceCounts };
