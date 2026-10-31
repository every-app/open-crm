import { CompanyRepository } from "@/server/features/companies/repositories/CompanyRepository";
import { ContactRepository } from "@/server/features/contacts/repositories/ContactRepository";
import { FieldValuesService } from "@/server/features/fields/services/FieldValuesService";
import type { ListEntity } from "@/shared/crm-enums";
import { companyListSchema } from "@/types/schemas/companies";
import { contactListSchema } from "@/types/schemas/contacts";
import { LIST_MATCHING_MAX } from "@/types/schemas/lists";

/**
 * Every live record the contacts or companies list's filters match (the
 * list's entity says which), up to LIST_MATCHING_MAX: what "add all
 * matching to a list" puts in it.
 */
export async function matchingIds(
  organizationId: string,
  entity: ListEntity,
  filters: Record<string, unknown>,
) {
  const query = { ...filters, archived: false, page: 1 };
  if (entity === "CONTACT") {
    const input = contactListSchema.parse(query);
    const conditions = await FieldValuesService.filterConditions(
      organizationId,
      "CONTACT",
      input.fields,
    );
    return ContactRepository.matchingIds(
      organizationId,
      input,
      conditions,
      LIST_MATCHING_MAX,
    );
  }
  const input = companyListSchema.parse(query);
  const conditions = await FieldValuesService.filterConditions(
    organizationId,
    "COMPANY",
    input.fields,
  );
  return CompanyRepository.matchingIds(
    organizationId,
    input,
    conditions,
    LIST_MATCHING_MAX,
  );
}
