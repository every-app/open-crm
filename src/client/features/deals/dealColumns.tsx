import type { MutableRefObject } from "react";
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
  dateColumn,
  ownerColumn,
  recordDateColumns,
} from "@/client/features/records/cells";

/** The columns the deals list hides until the Columns menu shows them. */
export const DEAL_HIDDEN_COLUMNS = ["createdAt"];

/**
 * The deals table. Every column sorts on the server; the amount by its
 * value in the reporting currency, the only figure that compares across
 * currencies.
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
      enableHiding: false,
      header: ({ column }) => <SortableHeader column={column} label="Deal" />,
      meta: { label: "Deal", width: "w-[21%]" },
      cell: ({ row }) => (
        <RecordLink
          record={{ kind: "deal", id: row.original.id }}
          className="block font-medium"
        >
          {row.original.name}
        </RecordLink>
      ),
    },
    {
      id: "company",
      accessorFn: (row) => row.company.name,
      enableSorting: true,
      header: ({ column }) => (
        <SortableHeader column={column} label="Company" />
      ),
      meta: { label: "Company", width: "w-[16%]" },
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
            <RecordLink record={{ kind: "company", id: company.id }}>
              {company.name}
            </RecordLink>
          </span>
        );
      },
    },
    {
      id: "stage",
      accessorFn: (row) => row.stage,
      enableSorting: true,
      header: ({ column }) => <SortableHeader column={column} label="Stage" />,
      meta: { label: "Stage", width: "w-[15%]" },
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
      meta: {
        label: "Amount",
        width: "w-[11%]",
        cellClassName: "text-right whitespace-nowrap",
      },
      cell: ({ row }) =>
        row.original.amount === null ? (
          <EmptyValue />
        ) : (
          <span className="tabular-nums">
            {formatAmount(row.original.amount, row.original.currency)}
          </span>
        ),
    },
    ownerColumn("w-[13%]"),
    {
      id: "expectedCloseDate",
      accessorFn: (row) => row.expectedCloseDate,
      enableSorting: true,
      header: ({ column }) => (
        <SortableHeader column={column} label="Close date" align="right" />
      ),
      meta: {
        label: "Close date",
        width: "w-[12%]",
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
      width: "w-[12%]",
    }),
    ...recordDateColumns<DealRow>(archived),
  ];
}
