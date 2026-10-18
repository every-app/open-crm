import { useQuery } from "@tanstack/react-query";
import {
  AlignLeft,
  CalendarDays,
  CircleUser,
  Hash,
  Link2,
  List,
  Mail,
  Phone,
  SquareCheck,
  Type,
  type LucideIcon,
} from "lucide-react";
import {
  countsFor,
  type ListFilter,
} from "@/client/components/table/FiltersMenu";
import { fieldsQueryOptions } from "@/client/features/fields/fieldQueries";
import { membersQueryOptions } from "@/client/features/members/memberQueries";
import type { FieldEntity, FieldType } from "@/shared/crm-enums";
import type { FieldFilter, FieldFilters } from "@/types/schemas/fields";
import type { FacetCounts } from "@/types/schemas/records";

// A list's custom field filters, under "Custom fields" in its Filters menu:
// its select and user fields offered as filters, each taking any of the
// options or members picked (offering those the list's search finds records
// for, with how many). The value is what the list keeps in its URL
// (`fieldFiltersSchema`) and hands to FieldValuesService.filterConditions.

const TYPE_ICONS: Record<FieldType, LucideIcon> = {
  TEXT: Type,
  LONG_TEXT: AlignLeft,
  NUMBER: Hash,
  DATE: CalendarDays,
  CHECKBOX: SquareCheck,
  SELECT: List,
  URL: Link2,
  EMAIL: Mail,
  PHONE: Phone,
  USER: CircleUser,
};

/** The most options or members one field's filter takes. */
const ANY_OF_MAX = 20;

/**
 * The live select and user fields offered as filters (`showOnFilter`), and
 * any other field the list is filtering by (from a saved view or a link),
 * so no filter applies unseen: one of another kind shows as it stands, to
 * be removed. Archived fields have no filter: the server ignores filters on
 * them.
 */
export function useFieldFilters(
  entity: FieldEntity,
  /** The list's counts of its filters' values; undefined while it loads. */
  facetCounts: FacetCounts | undefined,
  value: FieldFilters,
  onChange: (filters: FieldFilters) => void,
): ListFilter[] {
  const { data: fields } = useQuery(fieldsQueryOptions(entity));
  const { data: members } = useQuery(membersQueryOptions());

  const set = (key: string, filter: FieldFilter | null) => {
    const others = Object.fromEntries(
      Object.entries(value).filter(([other]) => other !== key),
    );
    onChange(filter ? { ...others, [key]: filter } : others);
  };

  return (fields ?? []).flatMap((field): ListFilter[] => {
    const filter = value[field.key];
    const shared = {
      key: `field:${field.key}`,
      label: field.label,
      icon: TYPE_ICONS[field.type],
      custom: true,
    };
    if (field.type === "SELECT" || field.type === "USER") {
      if (!field.showOnFilter && !filter) return [];
      return [
        {
          ...shared,
          options:
            field.type === "SELECT"
              ? field.options.map((option) => ({
                  value: option.id,
                  label: option.label,
                }))
              : (members ?? []).map((member) => ({
                  value: member.userId,
                  label: member.name,
                })),
          value: filter?.op === "anyOf" ? filter.values : [],
          counts: countsFor(facetCounts, `field:${field.key}`),
          max: ANY_OF_MAX,
          onChange: (values) =>
            set(field.key, values.length > 0 ? { op: "anyOf", values } : null),
        },
      ];
    }
    if (!filter) return [];
    const summary = summaryOf(filter);
    return [
      {
        ...shared,
        options: [{ value: summary, label: summary }],
        value: [summary],
        onChange: (values) => {
          if (values.length === 0) set(field.key, null);
        },
      },
    ];
  });
}

/** A filter the menu doesn't offer, as its token reads it. */
function summaryOf(filter: FieldFilter): string {
  switch (filter.op) {
    case "contains":
    case "equals":
      return `“${filter.value}”`;
    case "checked":
      return filter.value ? "Yes" : "No";
    case "range":
      return boundsSummary(filter.min, filter.max);
    case "dateRange":
      return boundsSummary(filter.from, filter.to);
    case "anyOf":
      return filter.values.join(", ");
  }
}

/** "10–50", "≥ 10" or "≤ 50". */
function boundsSummary(
  low: number | string | undefined,
  high: number | string | undefined,
): string {
  if (low !== undefined && high !== undefined) return `${low}–${high}`;
  return low !== undefined ? `≥ ${low}` : `≤ ${high}`;
}
