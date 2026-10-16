import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { DataTableFilterGroup } from "@/client/components/table/DataTableToolbar";
import { Input } from "@/client/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { useDebouncedDraft } from "@/client/hooks/useDebouncedDraft";
import { fieldsQueryOptions } from "@/client/features/fields/fieldQueries";
import { membersQueryOptions } from "@/client/features/members/memberQueries";
import type { Field } from "@/server/features/fields/services/fieldShape";
import type { FieldEntity } from "@/shared/crm-enums";
import type { FieldFilter, FieldFilters } from "@/types/schemas/fields";

type ControlProps = {
  label: string;
  filter: FieldFilter | undefined;
  onChange: (filter: FieldFilter | null) => void;
};

/**
 * A list filter panel's custom field filters: one per field offered as a
 * filter (`showOnFilter`). Text fields match what they contain, numbers and
 * dates a range, checkboxes yes or no, selects and users any of those
 * picked. `value` is what the list keeps in its URL (`fieldFiltersSchema`)
 * and hands to FieldValuesService.filterConditions.
 */
export function FieldFilterControls({
  entity,
  value,
  onChange,
}: {
  entity: FieldEntity;
  value: FieldFilters;
  onChange: (filters: FieldFilters) => void;
}) {
  const { data: fields } = useQuery(fieldsQueryOptions(entity));
  // Two filters can commit before the list re-renders with the first (a
  // debounced input and a pick): the second builds on the first.
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);
  const filterable = (fields ?? []).filter((field) => field.showOnFilter);
  if (filterable.length === 0) return null;

  const set = (key: string, filter: FieldFilter | null) => {
    const others = Object.fromEntries(
      Object.entries(latest.current).filter(([other]) => other !== key),
    );
    latest.current = filter ? { ...others, [key]: filter } : others;
    onChange(latest.current);
  };
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {filterable.map((field) => (
        <DataTableFilterGroup key={field.id} label={field.label}>
          <FieldFilterInput
            field={field}
            label={field.label}
            filter={value[field.key]}
            onChange={(filter) => set(field.key, filter)}
          />
        </DataTableFilterGroup>
      ))}
    </div>
  );
}

function FieldFilterInput({
  field,
  ...props
}: ControlProps & { field: Field }) {
  switch (field.type) {
    case "NUMBER":
      return <RangeInput {...props} kind="number" />;
    case "DATE":
      return <RangeInput {...props} kind="date" />;
    case "CHECKBOX":
      return <CheckedInput {...props} />;
    case "SELECT":
      return (
        <AnyOfInput
          {...props}
          choices={field.options.map((option) => ({
            value: option.id,
            label: option.label,
          }))}
        />
      );
    case "USER":
      return <MemberAnyOfInput {...props} />;
    default:
      return <ContainsInput {...props} />;
  }
}

function ContainsInput({ label, filter, onChange }: ControlProps) {
  const [draft, setDraft] = useDebouncedDraft(
    filter?.op === "contains" ? filter.value : "",
    (next) => onChange(next ? { op: "contains", value: next } : null),
    (next) => next.trim(),
  );
  return (
    <Input
      aria-label={`${label} contains`}
      placeholder="Contains…"
      className="h-7"
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

/** Min and max for a number, from and to (whole days) for a date. */
function RangeInput({
  label,
  filter,
  onChange,
  kind,
}: ControlProps & { kind: "number" | "date" }) {
  const [draft, setDraft] = useDebouncedDraft(
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
    <div className="grid grid-cols-2 gap-2">
      {(["low", "high"] as const).map((bound, index) => (
        <Input
          key={bound}
          type={kind}
          placeholder={names[index]}
          aria-label={`${label} ${names[index].toLowerCase()}`}
          className="h-7"
          value={draft[bound]}
          onChange={(event) =>
            setDraft({ ...draft, [bound]: event.target.value })
          }
        />
      ))}
    </div>
  );
}

const CHECKED_ITEMS = [
  { value: "any", label: "Any" },
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

function CheckedInput({ label, filter, onChange }: ControlProps) {
  const current =
    filter?.op === "checked" ? (filter.value ? "yes" : "no") : "any";
  return (
    <Select
      items={CHECKED_ITEMS}
      value={current}
      onValueChange={(next) =>
        onChange(
          next === "yes" || next === "no"
            ? { op: "checked", value: next === "yes" }
            : null,
        )
      }
    >
      <SelectTrigger size="sm" aria-label={label} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {CHECKED_ITEMS.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AnyOfInput({
  label,
  filter,
  onChange,
  choices,
}: ControlProps & { choices: { value: string; label: string }[] }) {
  const selected = filter?.op === "anyOf" ? filter.values : [];
  return (
    <Select
      multiple
      items={choices}
      value={selected}
      onValueChange={(next) =>
        onChange(
          next.length > 0 ? { op: "anyOf", values: next.slice(0, 20) } : null,
        )
      }
    >
      <SelectTrigger size="sm" aria-label={label} className="w-full">
        <SelectValue placeholder="Any">
          {(values: string[]) =>
            values.length === 0
              ? "Any"
              : values
                  .map(
                    (value) =>
                      choices.find((choice) => choice.value === value)?.label ??
                      value,
                  )
                  .join(", ")
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {choices.map((choice) => (
          <SelectItem key={choice.value} value={choice.value}>
            {choice.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function MemberAnyOfInput(props: ControlProps) {
  const { data: members } = useQuery(membersQueryOptions());
  return (
    <AnyOfInput
      {...props}
      choices={(members ?? []).map((member) => ({
        value: member.userId,
        label: member.name,
      }))}
    />
  );
}
