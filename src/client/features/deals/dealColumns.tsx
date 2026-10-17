import type { MutableRefObject } from "react";
import { Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { makeSelectionColumn } from "@/client/components/table/DataTable";
import { SortableHeader } from "@/client/components/table/SortableHeader";
import type { SelectionAnchor } from "@/client/components/table/tableSelection";
import { DealStageMenu } from "@/client/features/deals/DealStage";
import { formatAmount, type DealRow } from "@/client/features/deals/dealFormat";
import { LocalDay } from "@/client/features/records/LocalDateTime";
import { RecordLink } from "@/client/features/records/RecordLink";
import {
  EmptyValue,
  EntityLogo,
  OwnerCell,
  dateColumn,
} from "@/client/features/records/cells";

/**
 * The deals table. Every column but the archive date sorts on the server;
 * the amount sorts by its value in the reporting currency, the only figure
 * that compares across currencies.
 */
export function dealColumns({
  archived,
  anchorRef,
}: {
  archived: boolean;
  anchorRef: MutableRefObject<SelectionAnchor | null>;
}): ColumnDef<DealRow>[] {
  return [
    makeSelectionColumn(anchorRef, (row) => `Select ${row.original.name}`),
    {
      id: "name",
      accessorFn: (row) => row.name,
      enableSorting: true,
      header: ({ column }) => <SortableHeader column={column} label="Deal" />,
      meta: { cellClassName: "max-w-64" },
      cell: ({ row }) => (
        <Link
          from="/deals"
          to="/deals"
          search={(prev) => ({
            ...prev,
            record: row.original.id,
            tab: undefined,
          })}
          // The row opens it too; one navigation is enough.
          onClick={(event) => event.stopPropagation()}
          className="block truncate font-medium underline-offset-4 hover:underline"
        >
          {row.original.name}
        </Link>
      ),
    },
    {
      id: "company",
      accessorFn: (row) => row.company.name,
      enableSorting: true,
      header: ({ column }) => (
        <SortableHeader column={column} label="Company" />
      ),
      meta: { cellClassName: "max-w-52" },
      cell: ({ row }) => {
        const { company } = row.original;
        return (
          <span className="flex min-w-0 items-center gap-2">
            <EntityLogo
              src={company.iconUrl ?? company.logoUrl}
              darkSrc={company.iconDarkUrl}
              tone={company.iconTone}
              name={company.name}
              size="sm"
            />
            {/* The link opens the company, not the deal the row opens. */}
            <span
              className="min-w-0 truncate"
              onClick={(event) => event.stopPropagation()}
            >
              <RecordLink record={{ kind: "company", id: company.id }}>
                {company.name}
              </RecordLink>
            </span>
          </span>
        );
      },
    },
    {
      id: "stage",
      accessorFn: (row) => row.stage,
      enableSorting: true,
      header: ({ column }) => <SortableHeader column={column} label="Stage" />,
      meta: { cellClassName: "max-w-48" },
      cell: ({ row }) => (
        <DealStageMenu dealId={row.original.id} stage={row.original.stage} />
      ),
    },
    {
      id: "amount",
      accessorFn: (row) => row.baseAmount,
      enableSorting: true,
      sortDescFirst: true,
      header: ({ column }) => (
        <SortableHeader column={column} label="Amount" align="right" />
      ),
      meta: { cellClassName: "text-right whitespace-nowrap" },
      cell: ({ row }) =>
        row.original.amount === null ? (
          <EmptyValue />
        ) : (
          <span className="tabular-nums">
            {formatAmount(row.original.amount, row.original.currency)}
          </span>
        ),
    },
    {
      id: "owner",
      accessorFn: (row) => row.owner.name,
      enableSorting: true,
      header: ({ column }) => <SortableHeader column={column} label="Owner" />,
      meta: { cellClassName: "max-w-44" },
      cell: ({ row }) => <OwnerCell owner={row.original.owner} />,
    },
    {
      id: "expectedCloseDate",
      accessorFn: (row) => row.expectedCloseDate,
      enableSorting: true,
      header: ({ column }) => (
        <SortableHeader column={column} label="Close date" align="right" />
      ),
      meta: {
        cellClassName: "text-right whitespace-nowrap text-muted-foreground",
      },
      cell: ({ row }) =>
        row.original.expectedCloseDate ? (
          <LocalDay date={row.original.expectedCloseDate} />
        ) : (
          <EmptyValue />
        ),
    },
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
