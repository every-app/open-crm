import { useState } from "react";
import { toast } from "sonner";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from "@/client/components/SettingsSection";
import { Button } from "@/client/components/ui/button";
import { buildCsv, type CsvValue } from "@/client/lib/csv";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import type { ExportPage } from "@/server/features/exports/services/ExportService";
import { getExportPage } from "@/serverFunctions/exports";
import { EXPORT_DATASETS, type ExportDataset } from "@/types/schemas/exports";
import { downloadBlob } from "./download";

// Settings → General, for owners: everything the workspace holds, a CSV per
// dataset in one ZIP, fetched a page at a time (ExportService).

const LABELS: Record<ExportDataset, string> = {
  companies: "Companies",
  contacts: "Contacts",
  deals: "Deals",
  notes: "Notes",
  tasks: "Tasks",
  emails: "Emails",
  meetings: "Meetings",
  "website-activity": "Website activity",
  "form-submissions": "Form submissions",
};

async function datasetCsv(
  dataset: ExportDataset,
  onRows: (count: number) => void,
): Promise<string> {
  let header: string[] = [];
  const rows: CsvValue[][] = [];
  let cursor: string | null = null;
  do {
    const page: ExportPage = await getExportPage({
      data: { dataset, cursor },
    });
    header = page.header;
    rows.push(...page.rows);
    cursor = page.next;
    onRows(rows.length);
  } while (cursor);
  return buildCsv(header, rows);
}

export function ExportAllSection() {
  // While exporting: what it is reading, and how many rows so far.
  const [progress, setProgress] = useState<string | null>(null);

  const exportAll = async () => {
    setProgress("");
    try {
      const { strToU8, zipSync } = await import("fflate");
      const files: Record<string, Uint8Array> = {};
      for (const dataset of EXPORT_DATASETS) {
        const csv = await datasetCsv(dataset, (count) =>
          setProgress(`${LABELS[dataset]} · ${count.toLocaleString()}`),
        );
        files[`${dataset}.csv`] = strToU8(csv);
      }
      downloadBlob(
        `crm-export-${new Date().toISOString().slice(0, 10)}.zip`,
        new Blob([zipSync(files)], { type: "application/zip" }),
      );
      toast.success("Exported all data.");
    } catch (error) {
      toast.error(getStandardErrorMessage(error));
    } finally {
      setProgress(null);
    }
  };

  return (
    <SettingsSection title="Export">
      <SettingsCard>
        <SettingsRow label="All data" description={progress || undefined}>
          <Button
            variant="outline"
            pending={progress !== null}
            onClick={() => void exportAll()}
          >
            Export
          </Button>
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  );
}
