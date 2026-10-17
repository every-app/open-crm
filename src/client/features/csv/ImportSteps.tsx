import { cn } from "cn";
import { Badge } from "@/client/components/ui/badge";
import { Label } from "@/client/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/client/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { Switch } from "@/client/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import type { importRecords } from "@/serverFunctions/imports";
import type { FieldEntity } from "@/shared/crm-enums";
import type { ImportDuplicates, ImportOutcome } from "@/shared/imports";
import type { ParsedCsv } from "./csvFile";
import type { Target } from "./importMapping";

// The import dialog's steps: which field each column goes into and what
// happens to duplicates, the first rows checked, and the report at the end.

const SKIP = "__skip__";

const DUPLICATE_RULES: Record<FieldEntity, string> = {
  COMPANY: "A company with the same domain (or, with none, the same name)",
  CONTACT:
    "A contact with the same email (or, with none, the same name at the same company)",
  DEAL: "A deal with the same name at the same company",
};

const OUTCOME_LABELS: Record<ImportOutcome, string> = {
  created: "New",
  updated: "Update",
  skipped: "Skip",
  failed: "Error",
};

const OUTCOME_BADGES = {
  created: "success",
  updated: "soft",
  skipped: "secondary",
  failed: "destructive",
} as const;

const REPORT_LABELS: Record<ImportOutcome, string> = {
  created: "Added",
  updated: "Updated",
  skipped: "Skipped",
  failed: "Failed",
};

export type RowResult = Awaited<
  ReturnType<typeof importRecords>
>["results"][number];

export type Totals = Record<ImportOutcome, number>;

/** Each CSV column, its first value, and the field it goes into. */
export function ColumnMapping({
  csv,
  mapping,
  targets,
  onChange,
}: {
  csv: ParsedCsv;
  mapping: (string | null)[];
  targets: Target[];
  onChange: (mapping: (string | null)[]) => void;
}) {
  return (
    <div className="max-h-[45vh] overflow-y-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Column</TableHead>
            <TableHead>First value</TableHead>
            <TableHead className="w-64">Import into</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {csv.headers.map((header, column) => (
            <TableRow key={`${header}-${column}`}>
              <TableCell className="font-medium">{header}</TableCell>
              <TableCell className="max-w-48 truncate text-muted-foreground">
                {csv.rows.find((row) => row[column])?.[column] ?? "—"}
              </TableCell>
              <TableCell>
                <TargetSelect
                  label={`Import the ${header} column into`}
                  value={mapping[column] ?? null}
                  targets={targets}
                  taken={mapping}
                  onChange={(target) =>
                    onChange(
                      mapping.map((value, index) =>
                        index === column
                          ? target
                          : value === target && target !== null
                            ? null
                            : value,
                      ),
                    )
                  }
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** What the import did, row by row, and what to do about what it didn't. */
export function ImportReport({
  totals,
  failed,
  stoppedAt,
  error,
  total,
}: {
  totals: Totals;
  failed: number;
  /** How many rows it got through, when it stopped before the end. */
  stoppedAt: number | null;
  error: string | null;
  total: number;
}) {
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-4 gap-3">
        {(["created", "updated", "skipped", "failed"] as const).map(
          (outcome) => (
            <div
              key={outcome}
              className="rounded-lg border border-border px-3 py-2"
            >
              <dt className="text-xs text-muted-foreground">
                {REPORT_LABELS[outcome]}
              </dt>
              <dd
                className={cn(
                  "text-lg font-semibold tabular-nums",
                  outcome === "failed" && failed > 0 && "text-destructive",
                )}
              >
                {totals[outcome].toLocaleString()}
              </dd>
            </div>
          ),
        )}
      </dl>
      {stoppedAt !== null ? (
        <p className="text-sm text-muted-foreground">
          {error ? `${error} ` : null}
          The import stopped after {stoppedAt.toLocaleString()} of{" "}
          {total.toLocaleString()} rows. Run it again with the same file: rows
          already imported are recognized, so nothing is added twice.
        </p>
      ) : null}
    </div>
  );
}

function TargetSelect({
  label,
  value,
  targets,
  taken,
  onChange,
}: {
  label: string;
  value: string | null;
  targets: Target[];
  taken: (string | null)[];
  onChange: (target: string | null) => void;
}) {
  const items = [
    { value: SKIP, label: "Don't import" },
    ...targets.map((target) => ({
      value: target.id,
      label: target.required ? `${target.label} (required)` : target.label,
    })),
  ];
  return (
    <Select
      items={items}
      value={value ?? SKIP}
      onValueChange={(next) => onChange(!next || next === SKIP ? null : next)}
    >
      <SelectTrigger size="sm" className="w-full" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            <span
              className={cn(
                item.value !== value &&
                  taken.includes(item.value) &&
                  "text-muted-foreground",
              )}
            >
              {item.label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ImportOptions({
  entity,
  duplicates,
  onDuplicatesChange,
  research,
  onResearchChange,
}: {
  entity: FieldEntity;
  duplicates: ImportDuplicates;
  onDuplicatesChange: (value: ImportDuplicates) => void;
  research: boolean;
  onResearchChange: (value: boolean) => void;
}) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">
          When a row is already in the CRM
        </legend>
        <p className="text-xs text-muted-foreground">
          {DUPLICATE_RULES[entity]} is the same record.
        </p>
        <RadioGroup
          value={duplicates}
          onValueChange={(value) =>
            onDuplicatesChange(value === "update" ? "update" : "skip")
          }
        >
          <Label className="flex items-center gap-2 text-sm font-normal">
            <RadioGroupItem value="skip" />
            Skip it
          </Label>
          <Label className="flex items-center gap-2 text-sm font-normal">
            <RadioGroupItem value="update" />
            Update it with the row's values (blank cells change nothing)
          </Label>
        </RadioGroup>
      </fieldset>
      <div className="space-y-2">
        <Label className="flex items-center gap-2 text-sm font-medium">
          <Switch checked={research} onCheckedChange={onResearchChange} />
          Research new records with the agent
        </Label>
      </div>
    </div>
  );
}

export function PreviewTable({
  rows,
  headers,
  results,
  error,
}: {
  rows: { line: number; values: Record<string, string> }[];
  headers: Target[];
  results: RowResult[] | null;
  error: string | null;
}) {
  const shown = headers.filter((target) =>
    rows.some((row) => row.values[target.id]),
  );
  const byLine = new Map(results?.map((result) => [result.line, result]));
  return (
    <div className="space-y-2">
      {error || !results ? (
        <p className="text-sm text-muted-foreground">
          {error ?? "Checking the first rows…"}
        </p>
      ) : null}
      <div className="max-h-[45vh] overflow-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">Row</TableHead>
              <TableHead className="w-48">Result</TableHead>
              {shown.map((target) => (
                <TableHead key={target.id}>{target.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const result = byLine.get(row.line);
              return (
                <TableRow key={row.line}>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {row.line}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {result ? (
                      <span className="flex flex-col items-start gap-1">
                        <Badge variant={OUTCOME_BADGES[result.outcome]}>
                          {OUTCOME_LABELS[result.outcome]}
                        </Badge>
                        {result.error ? (
                          <span className="text-xs text-destructive">
                            {result.error}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  {shown.map((target) => (
                    <TableCell key={target.id} className="max-w-48 truncate">
                      {row.values[target.id] ?? ""}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
