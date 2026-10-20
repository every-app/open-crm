import type { MutableRefObject } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { SortableHeader } from "@/client/components/table/SortableHeader";
import { makeSelectionColumn } from "@/client/components/table/DataTable";
import type { SelectionAnchor } from "@/client/components/table/tableSelection";
import {
  location,
  type CompanyRow,
} from "@/client/features/companies/companyFormat";
import {
  EnrichmentIndicator,
  hasAgentNote,
} from "@/client/features/records/EnrichmentStatus";
import { RecordLink } from "@/client/features/records/RecordLink";
import {
  EntityLogo,
  NameCell,
  countColumn,
  dateColumn,
  ownerColumn,
  recordDateColumns,
  textColumn,
} from "@/client/features/records/cells";

/** The columns the companies list hides until the Columns menu shows them. */
export const COMPANY_HIDDEN_COLUMNS = ["location", "createdAt", "enrichment"];

/**
 * The companies table. Every column but the location and the research
 * state sorts on the server; the page adds the custom field columns
 * (useFieldColumns) after these.
 */
export function companyColumns({
  archived,
  anchorRef,
}: {
  archived: boolean;
  anchorRef: MutableRefObject<SelectionAnchor | null>;
}): ColumnDef<CompanyRow>[] {
  return [
    makeSelectionColumn(anchorRef, (row) => `Select ${row.original.name}`),
    {
      id: "name",
      accessorFn: (row) => row.name,
      enableSorting: true,
      enableHiding: false,
      header: ({ column }) => (
        <SortableHeader column={column} label="Company" />
      ),
      meta: { label: "Company", width: 192 },
      cell: ({ row }) => {
        const company = row.original;
        return (
          <div className="min-w-0 space-y-0.5">
            <RecordLink
              record={{ kind: "company", id: company.id }}
              className="block"
            >
              <NameCell
                media={
                  <EntityLogo
                    src={company.iconUrl ?? company.logoUrl}
                    darkSrc={company.iconDarkUrl}
                    tone={company.iconTone}
                    name={company.name}
                    size="sm"
                  />
                }
                name={company.name}
              />
            </RecordLink>
            {hasAgentNote(company) ? (
              <div className="pl-7.5">
                <EnrichmentIndicator
                  status={company.enrichmentStatus}
                  queued={company.queued}
                  waiting={company.waiting}
                />
              </div>
            ) : null}
          </div>
        );
      },
    },
    textColumn({
      id: "domain",
      header: "Domain",
      value: (row) => row.domain,
      width: 120,
      className: "text-muted-foreground",
      sortable: true,
    }),
    textColumn({
      id: "industry",
      header: "Industry",
      value: (row) => row.industry,
      width: 112,
      sortable: true,
    }),
    textColumn<CompanyRow>({
      id: "location",
      header: "Location",
      value: location,
      width: 112,
    }),
    ownerColumn(120),
    countColumn({
      id: "contacts",
      header: "Contacts",
      value: (row) => row.contactCount,
      width: 72,
    }),
    countColumn({
      id: "deals",
      header: "Open deals",
      value: (row) => row.openDealCount,
      width: 80,
    }),
    dateColumn({
      id: "lastActivity",
      header: "Last activity",
      value: (row) => row.lastActivityAt,
      sortable: true,
      width: 112,
    }),
    {
      id: "enrichment",
      header: "Enrichment",
      enableSorting: false,
      meta: { label: "Enrichment status", width: 112 },
      cell: ({ row }) => (
        <EnrichmentIndicator
          status={row.original.enrichmentStatus}
          queued={row.original.queued}
          waiting={row.original.waiting}
        />
      ),
    },
    ...recordDateColumns<CompanyRow>(archived),
  ];
}
