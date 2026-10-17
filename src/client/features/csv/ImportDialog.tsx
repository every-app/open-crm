import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Progress } from "@/client/components/ui/progress";
import { fieldsQueryOptions } from "@/client/features/fields/fieldQueries";
import { buildCsv } from "@/client/lib/csv";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { importRecords } from "@/serverFunctions/imports";
import type { FieldEntity } from "@/shared/crm-enums";
import { ENTITY_NOUNS } from "@/shared/fields";
import {
  IMPORT_CHUNK_SIZE,
  IMPORT_MAX_ROWS,
  type ImportDuplicates,
} from "@/shared/imports";
import { parseCsv, type ParsedCsv } from "./csvFile";
import { downloadCsv } from "./download";
import {
  autoMap,
  importTargets,
  mappedRows,
  missingTargets,
} from "./importMapping";
import {
  ColumnMapping,
  ImportOptions,
  ImportReport,
  PreviewTable,
  type RowResult,
  type Totals,
} from "./ImportSteps";

// Importing companies, contacts or deals from a CSV, in the browser: pick a
// file, say which field each column goes into, check the first rows, then
// send them all in chunks, with progress, and a report at the end. The
// server matches every row to the record it already is, so running an
// import again creates nothing twice.

const PREVIEW_ROWS = 10;
type Step =
  | { name: "pick"; error: string | null }
  | { name: "map" }
  | { name: "preview"; results: RowResult[] | null; error: string | null }
  | { name: "importing"; done: number }
  | {
      name: "done";
      totals: Totals;
      failed: RowResult[];
      stoppedAt: number | null;
      error: string | null;
    };

/** The import dialog of a list page; render it only while it is open. */
export function ImportDialog({
  entity,
  onClose,
}: {
  entity: FieldEntity;
  onClose: () => void;
}) {
  const noun = ENTITY_NOUNS[entity];
  const queryClient = useQueryClient();
  const fields = useQuery(fieldsQueryOptions(entity));
  const targets = useMemo(
    () => importTargets(entity, fields.data ?? []),
    [entity, fields.data],
  );
  const [step, setStep] = useState<Step>({ name: "pick", error: null });
  const [file, setFile] = useState<{ name: string; csv: ParsedCsv } | null>(
    null,
  );
  const [mapping, setMapping] = useState<(string | null)[]>([]);
  const [duplicates, setDuplicates] = useState<ImportDuplicates>("skip");
  const [research, setResearch] = useState(true);
  const stopRef = useRef(false);

  const rows = useMemo(
    () => (file ? mappedRows(file.csv.rows, mapping) : []),
    [file, mapping],
  );
  const missing = missingTargets(entity, mapping, targets);
  const busy = step.name === "importing";

  const send = (chunk: typeof rows, dryRun: boolean) =>
    importRecords({
      data: { entity, duplicates, research, dryRun, rows: chunk },
    });

  const pick = async (picked: File | undefined) => {
    if (!picked) return;
    const csv = parseCsv(await picked.text());
    if (csv.rows.length === 0) {
      setStep({
        name: "pick",
        error: "That file has no rows under its header row.",
      });
      return;
    }
    if (csv.rows.length > IMPORT_MAX_ROWS) {
      setStep({
        name: "pick",
        error: `That file has ${csv.rows.length.toLocaleString()} rows. Import at most ${IMPORT_MAX_ROWS.toLocaleString()} at a time: split it into smaller files.`,
      });
      return;
    }
    setFile({ name: picked.name, csv });
    setMapping(autoMap(csv.headers, targets));
    setStep({ name: "map" });
  };

  const preview = async () => {
    setStep({ name: "preview", results: null, error: null });
    try {
      const { results } = await send(rows.slice(0, PREVIEW_ROWS), true);
      setStep({ name: "preview", results, error: null });
    } catch (error) {
      setStep({
        name: "preview",
        results: null,
        error: getStandardErrorMessage(error),
      });
    }
  };

  const run = async () => {
    stopRef.current = false;
    const totals: Totals = { created: 0, updated: 0, skipped: 0, failed: 0 };
    const failed: RowResult[] = [];
    let done = 0;
    setStep({ name: "importing", done });
    for (let start = 0; start < rows.length; start += IMPORT_CHUNK_SIZE) {
      if (stopRef.current) break;
      try {
        const { results } = await send(
          rows.slice(start, start + IMPORT_CHUNK_SIZE),
          false,
        );
        for (const result of results) {
          totals[result.outcome] += 1;
          if (result.outcome === "failed") failed.push(result);
        }
      } catch (error) {
        setStep({
          name: "done",
          totals,
          failed,
          stoppedAt: start,
          error: getStandardErrorMessage(error),
        });
        await settle();
        return;
      }
      done = Math.min(start + IMPORT_CHUNK_SIZE, rows.length);
      setStep({ name: "importing", done });
    }
    setStep({
      name: "done",
      totals,
      failed,
      stoppedAt: done < rows.length ? done : null,
      error: null,
    });
    await settle();
  };

  // Every list could hold a new record: contacts and deals add companies.
  const settle = () =>
    Promise.all(
      [["companies"], ["contacts"], ["deals"], ["agent"], ["dashboard"]].map(
        (queryKey) => queryClient.invalidateQueries({ queryKey }),
      ),
    );

  const downloadFailed = (failedRows: RowResult[]) => {
    if (!file) return;
    const byLine = new Map(failedRows.map((row) => [row.line, row.error]));
    downloadCsv(
      `${noun.many}-import-errors.csv`,
      buildCsv(
        ["Row", ...file.csv.headers, "Error"],
        file.csv.rows.flatMap((cells, index) => {
          const line = index + 2;
          return byLine.has(line)
            ? [[line, ...cells, byLine.get(line) ?? ""]]
            : [];
        }),
      ),
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="sm:max-w-3xl" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>Import {noun.many} from a CSV</DialogTitle>
          <DialogDescription>
            {file
              ? `${file.name}: ${file.csv.rows.length.toLocaleString()} ${file.csv.rows.length === 1 ? "row" : "rows"}`
              : "A spreadsheet's CSV export, with a header row."}
          </DialogDescription>
        </DialogHeader>

        {step.name === "pick" ? (
          <div className="space-y-3">
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-10 text-center hover:bg-muted/50 focus-within:ring-3 focus-within:ring-ring/50">
              <FileUp aria-hidden className="size-6 text-muted-foreground" />
              <span className="text-sm font-medium">Choose a CSV file</span>
              <span className="text-xs text-muted-foreground">
                The first row names the columns; you choose where each goes
                next.
              </span>
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={fields.isPending}
                className="sr-only"
                onChange={(event) => void pick(event.target.files?.[0])}
              />
            </label>
            {step.error ? (
              <p className="text-sm text-destructive">{step.error}</p>
            ) : null}
          </div>
        ) : null}

        {step.name === "map" && file ? (
          <div className="space-y-5">
            <ColumnMapping
              csv={file.csv}
              mapping={mapping}
              targets={targets}
              onChange={setMapping}
            />
            <ImportOptions
              entity={entity}
              duplicates={duplicates}
              onDuplicatesChange={setDuplicates}
              research={research}
              onResearchChange={setResearch}
            />
            {missing.length > 0 ? (
              <p className="text-sm text-destructive">
                Choose a column for {missing.join(" and ")}.
              </p>
            ) : null}
          </div>
        ) : null}

        {step.name === "preview" ? (
          <PreviewTable
            rows={rows.slice(0, PREVIEW_ROWS)}
            headers={targets}
            results={step.results}
            error={step.error}
            total={rows.length}
          />
        ) : null}

        {step.name === "importing" ? (
          <div className="space-y-2 py-4">
            <Progress value={(step.done / rows.length) * 100} />
            <p className="text-sm text-muted-foreground">
              {step.done.toLocaleString()} of {rows.length.toLocaleString()}{" "}
              rows imported…
            </p>
          </div>
        ) : null}

        {step.name === "done" ? (
          <ImportReport
            totals={step.totals}
            failed={step.failed.length}
            stoppedAt={step.stoppedAt}
            error={step.error}
            total={rows.length}
            research={research}
          />
        ) : null}

        <DialogFooter>
          {step.name === "map" ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setFile(null);
                  setStep({ name: "pick", error: null });
                }}
              >
                Choose another file
              </Button>
              <Button
                disabled={missing.length > 0}
                onClick={() => void preview()}
              >
                Check the first rows
              </Button>
            </>
          ) : null}
          {step.name === "preview" ? (
            <>
              <Button
                variant="outline"
                onClick={() => setStep({ name: "map" })}
              >
                Back
              </Button>
              <Button
                disabled={step.results === null && step.error === null}
                onClick={() => void run()}
              >
                Import {rows.length.toLocaleString()}{" "}
                {rows.length === 1 ? "row" : "rows"}
              </Button>
            </>
          ) : null}
          {step.name === "importing" ? (
            <Button
              variant="outline"
              onClick={() => {
                stopRef.current = true;
              }}
            >
              Stop
            </Button>
          ) : null}
          {step.name === "done" ? (
            <>
              {step.failed.length > 0 ? (
                <Button
                  variant="outline"
                  onClick={() => downloadFailed(step.failed)}
                >
                  Download failed rows
                </Button>
              ) : null}
              <Button onClick={onClose}>Done</Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
