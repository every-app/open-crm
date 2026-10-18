import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import { FieldsService } from "@/server/features/fields/services/FieldsService";
import type { FieldEntity } from "@/shared/crm-enums";
import { UNASSIGNED, type FacetCounts } from "@/types/schemas/records";

// The list tools' facet counts (how many records the search finds have each
// value of each filter), with values named as the tools' filters take them:
// owners and user fields by member email, a select's options by label. A
// value no filter takes (a former member, a retired option) is left out.

/** The list tools' description of the counts. */
export const FACET_COUNTS_NOTE =
  "`facetCounts` says how many of the records `query` finds (live or archived) have each value of each filter, whatever the other filters; custom fields are under `field:<key>`.";

function renamed(
  counts: Record<string, number>,
  name: (value: string) => string | undefined,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(counts).flatMap(([value, count]) => {
      const named = name(value);
      return named ? [[named, count]] : [];
    }),
  );
}

export async function toolFacetCounts(
  organizationId: string,
  entity: FieldEntity,
  facetCounts: FacetCounts,
): Promise<FacetCounts> {
  const [members, fields] = await Promise.all([
    AuthRepository.listMembers(organizationId),
    FieldsService.list(organizationId, entity),
  ]);
  const emails = new Map(
    members.map((member) => [member.userId, member.email]),
  );
  const named: FacetCounts = {};
  for (const [filter, counts] of Object.entries(facetCounts)) {
    const field = fields.find(({ key }) => filter === `field:${key}`);
    if (filter === "owner") {
      named[filter] = renamed(counts, (id) =>
        id === UNASSIGNED ? id : emails.get(id),
      );
    } else if (field?.type === "USER") {
      named[filter] = renamed(counts, (id) => emails.get(id));
    } else if (field?.type === "SELECT") {
      const labels = new Map(
        field.options.map((option) => [option.id, option.label]),
      );
      named[filter] = renamed(counts, (id) => labels.get(id));
    } else {
      named[filter] = counts;
    }
  }
  return named;
}
