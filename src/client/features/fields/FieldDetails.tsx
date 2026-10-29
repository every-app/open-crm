import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { Coverage, FieldHeader } from "@/client/features/fields/FieldSections";
import { fieldCoverageQueryOptions } from "@/client/features/fields/fieldQueries";
import {
  FILTER_PLACEMENT,
  KEY_LABEL,
  OPTIONS_LABEL,
  REQUIRED_LABEL,
  SHEET_PLACEMENT,
  TABLE_PLACEMENT,
  TYPE_LABEL,
} from "@/client/features/fields/fieldsCopy";
import type { Field } from "@/server/features/fields/services/fieldShape";

/**
 * A field as someone who can't change fields reads it: what the editor
 * holds, as text, and how much of it is filled.
 */
export function FieldDetails({
  field,
  onDone,
}: {
  field: Field;
  onDone: () => void;
}) {
  const coverage = useQuery(fieldCoverageQueryOptions(field.entity, field.id));
  return (
    <>
      <FieldHeader
        entity={field.entity}
        title={field.label}
        coverage={coverage.data}
        onBack={onDone}
      />
      <div className="flex-1 space-y-6 overflow-y-auto p-4">
        <dl className="space-y-6">
          <Row label={KEY_LABEL}>
            <span className="font-mono text-xs">{field.key}</span>
          </Row>
          <div className="space-y-3">
            <Row label={TYPE_LABEL}>{field.typeLabel}</Row>
            {field.type === "SELECT" ? (
              <Row label={OPTIONS_LABEL} stacked>
                <ul className="space-y-1">
                  {field.options.map((option) => (
                    <li key={option.id}>{option.label}</li>
                  ))}
                </ul>
              </Row>
            ) : null}
          </div>
          <div className="space-y-2.5">
            <Row label={SHEET_PLACEMENT}>
              <Flag on={field.showOnSheet} />
            </Row>
            <Row label={TABLE_PLACEMENT}>
              <Flag on={field.showOnTable} />
            </Row>
            <Row label={FILTER_PLACEMENT}>
              <Flag on={field.showOnFilter} />
            </Row>
            <Row label={REQUIRED_LABEL}>
              <Flag on={field.required} />
            </Row>
          </div>
        </dl>
        {coverage.data ? (
          <Coverage field={field} coverage={coverage.data} />
        ) : null}
      </div>
    </>
  );
}

/** A part of the definition: its name, and its value beside it or under it. */
function Row({
  label,
  stacked = false,
  children,
}: {
  label: string;
  stacked?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={
        stacked ? "space-y-1.5" : "flex items-baseline justify-between gap-4"
      }
    >
      <dt className="text-sm font-medium">{label}</dt>
      <dd
        className={
          stacked
            ? "text-sm text-muted-foreground [overflow-wrap:anywhere]"
            : "min-w-0 truncate text-sm text-muted-foreground"
        }
      >
        {children}
      </dd>
    </div>
  );
}

/** On, a check; off, a dash. */
function Flag({ on }: { on: boolean }) {
  return on ? (
    <>
      <Check aria-hidden className="inline size-4 text-foreground" />
      <span className="sr-only">Yes</span>
    </>
  ) : (
    <>
      <span aria-hidden>—</span>
      <span className="sr-only">No</span>
    </>
  );
}
