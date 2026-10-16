import type { MutableRefObject } from "react";
import { Link } from "@tanstack/react-router";
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
  isEnriching,
} from "@/client/features/records/EnrichmentStatus";
import {
  EntityLogo,
  NameCell,
  countColumn,
  dateColumn,
  ownerColumn,
  textColumn,
} from "@/client/features/records/cells";

/**
 * The companies table. Name, last activity and created date sort on the
 * server; custom-field columns join after these when the fields feature adds
 * them to lists.
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
      header: ({ column }) => (
        <SortableHeader column={column} label="Company" />
      ),
      meta: { cellClassName: "max-w-72" },
      cell: ({ row }) => {
        const company = row.original;
        return (
          <div className="min-w-0 space-y-0.5">
            <Link
              to="/companies"
              search={(prev) => ({
                ...prev,
                record: company.id,
                tab: undefined,
              })}
              // The row opens it too; one navigation is enough.
              onClick={(event) => event.stopPropagation()}
              className="block min-w-0 underline-offset-4 hover:underline"
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
            </Link>
            {isEnriching(company.enrichmentStatus, company.queued) ? (
              <div className="pl-7.5">
                <EnrichmentIndicator
                  status={company.enrichmentStatus}
                  queued={company.queued}
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
      className: "text-muted-foreground",
    }),
    textColumn({
      id: "industry",
      header: "Industry",
      value: (row) => row.industry,
    }),
    textColumn<CompanyRow>({
      id: "location",
      header: "Location",
      value: location,
    }),
    ownerColumn(),
    countColumn({
      id: "contacts",
      header: "Contacts",
      value: (row) => row.contactCount,
    }),
    countColumn({
      id: "deals",
      header: "Open deals",
      value: (row) => row.openDealCount,
    }),
    dateColumn({
      id: "lastActivity",
      header: "Last activity",
      value: (row) => row.lastActivityAt,
      sortable: true,
    }),
    archived
      ? dateColumn({
          id: "archivedAt",
          header: "Archived",
          value: (row) => row.archivedAt,
        })
      : dateColumn({
          id: "createdAt",
          header: "Created",
          value: (row) => row.createdAt,
          sortable: true,
        }),
  ];
}
