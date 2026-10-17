import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { fieldsQueryOptions } from "@/client/features/fields/fieldQueries";
import { membersQueryOptions } from "@/client/features/members/memberQueries";
import { buildCsv, type CsvValue } from "@/client/lib/csv";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import type { FieldEntity } from "@/shared/crm-enums";
import { ENTITY_NOUNS, type FieldValueJson } from "@/shared/fields";
import { downloadCsv } from "./download";

// Exporting a record list as it stands (its search, owners, archived view
// and filters): every page of it, its own columns and the custom fields it
// shows as columns, in a CSV the import reads back.

/** The most rows a list page returns (listInputSchema). */
const EXPORT_PAGE_SIZE = 100;

export type ExportColumn<Row> = [header: string, value: (row: Row) => CsvValue];

type Page<Row> = { rows: Row[]; total: number };

/** A day as the import reads it back: 2027-03-31. */
export const csvDay = (value: string | null | undefined) =>
  value ? value.slice(0, 10) : "";

export function ExportButton<
  Row extends { fields: Record<string, FieldValueJson> },
>({
  entity,
  columns,
  fetchPage,
}: {
  entity: FieldEntity;
  columns: ExportColumn<Row>[];
  /** One page of the list as it stands, `pageSize` rows long. */
  fetchPage: (page: number, pageSize: number) => Promise<Page<Row>>;
}) {
  const noun = ENTITY_NOUNS[entity];
  const fields = useQuery(fieldsQueryOptions(entity));
  const members = useQuery(membersQueryOptions());
  const [pending, setPending] = useState(false);

  const exportList = async () => {
    setPending(true);
    try {
      const rows: Row[] = [];
      for (let page = 1; ; page += 1) {
        const result = await fetchPage(page, EXPORT_PAGE_SIZE);
        rows.push(...result.rows);
        if (
          result.rows.length < EXPORT_PAGE_SIZE ||
          rows.length >= result.total
        )
          break;
      }
      const custom = (fields.data ?? []).filter((field) => field.showOnTable);
      const emailOf = (userId: string) =>
        members.data?.find((member) => member.userId === userId)?.email ??
        userId;
      const csv = buildCsv(
        [
          ...columns.map(([header]) => header),
          ...custom.map((field) => field.label),
        ],
        rows.map((row) => [
          ...columns.map(([, value]) => value(row)),
          ...custom.map((field) => {
            const value = row.fields[field.key] ?? null;
            if (field.type === "USER" && typeof value === "string") {
              return emailOf(value);
            }
            if (field.type === "DATE" && typeof value === "string") {
              return csvDay(value);
            }
            return typeof value === "boolean" ? String(value) : value;
          }),
        ]),
      );
      downloadCsv(
        `${noun.many}-${new Date().toISOString().slice(0, 10)}.csv`,
        csv,
      );
      toast.success(
        `Exported ${rows.length.toLocaleString()} ${rows.length === 1 ? noun.one : noun.many}.`,
      );
    } catch (error) {
      toast.error(getStandardErrorMessage(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      pending={pending}
      onClick={() => void exportList()}
    >
      <Download data-icon="inline-start" />
      Export
    </Button>
  );
}
