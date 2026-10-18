import { useEffect, useRef, useState } from "react";
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
  FilterChip,
  FilterChipShell,
  countsFor,
} from "@/client/components/table/FilterChip";
import { Input } from "@/client/components/ui/input";
import { useDebouncedDraft } from "@/client/hooks/useDebouncedDraft";
import { fieldsQueryOptions } from "@/client/features/fields/fieldQueries";
import { membersQueryOptions } from "@/client/features/members/memberQueries";
import type { Field } from "@/server/features/fields/services/fieldShape";
import type { FieldEntity, FieldType } from "@/shared/crm-enums";
import type { FieldFilter, FieldFilters } from "@/types/schemas/fields";
import type { FacetCounts } from "@/types/schemas/records";

// A list's custom field filters, as chips after its own: one per field
// offered as a filter. Text fields match what they contain, numbers and
// dates a range, checkboxes yes or no, selects and users any of those
// picked (offering those the list's search finds records for, with how
// many). The value is what the list keeps in its URL (`fieldFiltersSchema`)
// and hands to FieldValuesService.filterConditions.

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

type ChipProps = {
  field: Field;
  filter: FieldFilter | undefined;
  onChange: (filter: FieldFilter | null) => void;
  /** Records per option or member, for selects and user fields. */
  counts: Record<string, number> | undefined;
};

/**
 * The live fields a list shows filters for: those offered as filters
 * (`showOnFilter`), and any other one it is filtering by (from a saved view
 * or a link), so no filter applies unseen. Archived fields have no filter:
 * the server ignores filters on them.
 */
function useFilterableFields(entity: FieldEntity, value: FieldFilters) {
  const { data } = useQuery(fieldsQueryOptions(entity));
  return (data ?? []).filter(
    (field) => field.showOnFilter || value[field.key] !== undefined,
  );
}

/** One chip per custom field the list filters by, after its own filters. */
export function FieldFilterChips({
  entity,
  facetCounts,
  value,
  onChange,
}: {
  entity: FieldEntity;
  /** The list's counts of its filters' values; undefined while it loads. */
  facetCounts: FacetCounts | undefined;
  value: FieldFilters;
  onChange: (filters: FieldFilters) => void;
}) {
  const fields = useFilterableFields(entity, value);
  // Two filters can commit before the list re-renders with the first (a
  // debounced input and a pick): the second builds on the first.
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

  return fields.map((field) => {
    const props: ChipProps = {
      field,
      filter: value[field.key],
      onChange: (filter) => set(field.key, filter),
      counts: countsFor(facetCounts, `field:${field.key}`),
    };
    switch (field.type) {
      case "SELECT":
        return <SelectChip key={field.id} {...props} />;
      case "USER":
        return <MemberChip key={field.id} {...props} />;
      case "CHECKBOX":
        return <CheckedChip key={field.id} {...props} />;
      case "NUMBER":
      case "DATE":
        return <RangeChip key={field.id} {...props} />;
      default:
        return <ContainsChip key={field.id} {...props} />;
    }
  });
}

function AnyOfChip({
  field,
  filter,
  onChange,
  counts,
  options,
}: ChipProps & { options: { value: string; label: string }[] }) {
  return (
    <FilterChip
      label={field.label}
      icon={TYPE_ICONS[field.type]}
      options={options}
      value={filter?.op === "anyOf" ? filter.values : []}
      counts={counts}
      max={20}
      onChange={(values) =>
        onChange(values.length > 0 ? { op: "anyOf", values } : null)
      }
    />
  );
}

function SelectChip(props: ChipProps) {
  return (
    <AnyOfChip
      {...props}
      options={props.field.options.map((option) => ({
        value: option.id,
        label: option.label,
      }))}
    />
  );
}

function MemberChip(props: ChipProps) {
  const { data: members } = useQuery(membersQueryOptions());
  return (
    <AnyOfChip
      {...props}
      options={(members ?? []).map((member) => ({
        value: member.userId,
        label: member.name,
      }))}
    />
  );
}

const CHECKED_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

function CheckedChip({ field, filter, onChange }: ChipProps) {
  return (
    <FilterChip
      label={field.label}
      icon={TYPE_ICONS[field.type]}
      options={CHECKED_OPTIONS}
      single
      value={filter?.op === "checked" ? [filter.value ? "yes" : "no"] : []}
      onChange={([picked]) =>
        onChange(picked ? { op: "checked", value: picked === "yes" } : null)
      }
    />
  );
}

function ContainsChip({ field, filter, onChange }: ChipProps) {
  const [open, setOpen] = useState(false);
  const applied = filter?.op === "contains" ? filter.value : "";
  const [draft, setDraft] = useDebouncedDraft(
    applied,
    (next) => onChange(next ? { op: "contains", value: next } : null),
    (next) => next.trim(),
  );
  return (
    <FilterChipShell
      label={field.label}
      icon={TYPE_ICONS[field.type]}
      summary={applied ? `“${applied}”` : undefined}
      open={open}
      onOpenChange={setOpen}
      onClear={() => onChange(null)}
    >
      <div className="p-2">
        <Input
          aria-label={`${field.label} contains`}
          placeholder="Contains…"
          className="h-8"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </div>
    </FilterChipShell>
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

/** "10–50", "≥ 10" or "≤ 50": a range as its chip shows it. */
function rangeSummary({ low, high }: Bounds): string | undefined {
  if (low && high) return `${low}–${high}`;
  if (low) return `≥ ${low}`;
  if (high) return `≤ ${high}`;
  return undefined;
}

/** Min and max for a number, from and to (whole days) for a date. */
function RangeChip({ field, filter, onChange }: ChipProps) {
  const [open, setOpen] = useState(false);
  const kind = field.type === "DATE" ? "date" : "number";
  const applied = boundsOf(filter);
  const [draft, setDraft] = useDebouncedDraft(
    applied,
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
    <FilterChipShell
      label={field.label}
      icon={TYPE_ICONS[field.type]}
      summary={rangeSummary(applied)}
      open={open}
      onOpenChange={setOpen}
      onClear={() => onChange(null)}
    >
      <div className="grid grid-cols-2 gap-2 p-2">
        {(["low", "high"] as const).map((bound, index) => (
          <Input
            key={bound}
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
    </FilterChipShell>
  );
}
