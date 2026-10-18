import { useEffect, useRef } from "react";
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
import { Input } from "@/client/components/ui/input";
import { useDebouncedDraft } from "@/client/hooks/useDebouncedDraft";
import { fieldsQueryOptions } from "@/client/features/fields/fieldQueries";
import { membersQueryOptions } from "@/client/features/members/memberQueries";
import type { Field } from "@/server/features/fields/services/fieldShape";
import type { FieldEntity, FieldType } from "@/shared/crm-enums";
import type { FieldFilter, FieldFilters } from "@/types/schemas/fields";
import type { FacetCounts } from "@/types/schemas/records";

// A list's custom field filters, under "Custom fields" in its Filters menu:
// one per field offered as a filter. Text fields match what they contain,
// numbers and dates a range, checkboxes yes or no, selects and users any of
// those picked (offering those the list's search finds records for, with
// how many). The value is what the list keeps in its URL
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

const CHECKED_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

type SetFilter = (filter: FieldFilter | null) => void;

/**
 * The live fields offered as filters (`showOnFilter`), and any other one
 * the list is filtering by (from a saved view or a link), so no filter
 * applies unseen. Archived fields have no filter: the server ignores
 * filters on them.
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
  // Two filters can commit before the list re-renders with the first (a
  // typed one and a pick): the second builds on the first.
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);

  const set = (key: string, filter: FieldFilter | null) => {
    const others = Object.fromEntries(
      Object.entries(latest.current).filter(([other]) => other !== key),
    );
    latest.current = filter ? { ...others, [key]: filter } : others;
    onChange(latest.current);
  };

  return (fields ?? [])
    .filter((field) => field.showOnFilter || value[field.key] !== undefined)
    .map((field): ListFilter => {
      const filter = value[field.key];
      const setFilter: SetFilter = (next) => set(field.key, next);
      const shared = {
        key: `field:${field.key}`,
        label: field.label,
        icon: TYPE_ICONS[field.type],
        custom: true,
      };
      switch (field.type) {
        case "SELECT":
        case "USER":
          return {
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
              setFilter(values.length > 0 ? { op: "anyOf", values } : null),
          };
        case "CHECKBOX":
          return {
            ...shared,
            options: CHECKED_OPTIONS,
            single: true,
            value:
              filter?.op === "checked" ? [filter.value ? "yes" : "no"] : [],
            onChange: ([picked]) =>
              setFilter(
                picked ? { op: "checked", value: picked === "yes" } : null,
              ),
          };
        case "NUMBER":
        case "DATE": {
          const summary = rangeSummary(boundsOf(filter));
          return {
            ...shared,
            options: [],
            value: summary ? [summary] : [],
            onChange: () => setFilter(null),
            panel: (
              <RangeInputs field={field} filter={filter} onChange={setFilter} />
            ),
          };
        }
        default: {
          const applied = filter?.op === "contains" ? filter.value : "";
          return {
            ...shared,
            options: [],
            value: applied ? [`“${applied}”`] : [],
            onChange: () => setFilter(null),
            panel: (
              <ContainsInput
                field={field}
                applied={applied}
                onChange={setFilter}
              />
            ),
          };
        }
      }
    });
}

/**
 * What's typed into a filter's inputs, applied after a pause as the list
 * search is. The submenu can close before the pause ends: what was typed
 * then applies at once.
 */
function useTypedFilter<T>(
  applied: T,
  commit: (value: T) => void,
  normalize: (value: T) => T,
) {
  const [draft, setDraft] = useDebouncedDraft(applied, commit, normalize);
  const latest = useRef({ draft, applied, commit, normalize });
  useEffect(() => {
    latest.current = { draft, applied, commit, normalize };
  });
  useEffect(
    () => () => {
      const typed = latest.current;
      const next = typed.normalize(typed.draft);
      if (JSON.stringify(next) !== JSON.stringify(typed.applied)) {
        typed.commit(next);
      }
    },
    [],
  );
  return [draft, setDraft] as const;
}

function ContainsInput({
  field,
  applied,
  onChange,
}: {
  field: Field;
  applied: string;
  onChange: SetFilter;
}) {
  const [draft, setDraft] = useTypedFilter(
    applied,
    (next) => onChange(next ? { op: "contains", value: next } : null),
    (next) => next.trim(),
  );
  return (
    <Input
      autoFocus
      aria-label={`${field.label} contains`}
      placeholder="Contains…"
      className="h-8"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
    />
  );
}

type Bounds = { low: string; high: string };

function boundsOf(filter: FieldFilter | undefined): Bounds {
  if (filter?.op === "range") {
    return { low: String(filter.min ?? ""), high: String(filter.max ?? "") };
  }
  if (filter?.op === "dateRange") {
    return { low: filter.from ?? "", high: filter.to ?? "" };
  }
  return { low: "", high: "" };
}

const asNumber = (text: string) =>
  text === "" || !Number.isFinite(Number(text)) ? undefined : Number(text);

/** "10–50", "≥ 10" or "≤ 50": a range as its token shows it. */
function rangeSummary({ low, high }: Bounds): string | undefined {
  if (low && high) return `${low}–${high}`;
  if (low) return `≥ ${low}`;
  if (high) return `≤ ${high}`;
  return undefined;
}

/** Min and max for a number, from and to (whole days) for a date. */
function RangeInputs({
  field,
  filter,
  onChange,
}: {
  field: Field;
  filter: FieldFilter | undefined;
  onChange: SetFilter;
}) {
  const kind = field.type === "DATE" ? "date" : "number";
  const [draft, setDraft] = useTypedFilter(
    boundsOf(filter),
    ({ low, high }) => {
      if (!low && !high) return onChange(null);
      onChange(
        kind === "number"
          ? { op: "range", min: asNumber(low), max: asNumber(high) }
          : {
              op: "dateRange",
              from: low || undefined,
              to: high || undefined,
            },
      );
    },
    // As the URL will give it back: "10." is 10.
    ({ low, high }) =>
      kind === "number"
        ? {
            low: String(asNumber(low.trim()) ?? ""),
            high: String(asNumber(high.trim()) ?? ""),
          }
        : { low, high },
  );
  const names =
    kind === "number" ? (["Min", "Max"] as const) : (["From", "To"] as const);
  return (
    // Two dates don't fit side by side: they stack.
    <div
      className={kind === "number" ? "grid grid-cols-2 gap-2" : "grid gap-2"}
    >
      {(["low", "high"] as const).map((bound, index) => (
        <Input
          key={bound}
          autoFocus={index === 0}
          type={kind}
          placeholder={names[index]}
          aria-label={`${field.label} ${names[index].toLowerCase()}`}
          className="h-8"
          value={draft[bound]}
          onChange={(event) =>
            setDraft({ ...draft, [bound]: event.target.value })
          }
        />
      ))}
    </div>
  );
}
