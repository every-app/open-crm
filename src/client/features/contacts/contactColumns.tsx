import type { MutableRefObject, ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { SortableHeader } from "@/client/components/table/SortableHeader";
import { makeSelectionColumn } from "@/client/components/table/DataTable";
import type { SelectionAnchor } from "@/client/components/table/tableSelection";
import { fullName } from "@/client/features/companies/companyFormat";
import type { ContactRow } from "@/client/features/contacts/contactFormat";
import {
  EnrichmentIndicator,
  hasAgentNote,
} from "@/client/features/records/EnrichmentStatus";
import { RecordLink } from "@/client/features/records/RecordLink";
import {
  EmptyValue,
  EntityLogo,
  NameCell,
  PersonAvatar,
  dateColumn,
  ownerColumn,
  recordDateColumns,
} from "@/client/features/records/cells";

/** The columns the contacts list hides until the Columns menu shows them. */
export const CONTACT_HIDDEN_COLUMNS = ["createdAt"];

/**
 * A text column the server sorts, blanks last either way. Its value doubles
 * as the accessor: the table only sorts a column with one.
 */
function sortableColumn(options: {
  id: "title" | "email" | "company";
  header: string;
  value: (row: ContactRow) => string | null;
  width: string;
  cell?: (row: ContactRow) => ReactNode;
  className?: string;
}): ColumnDef<ContactRow> {
  return {
    id: options.id,
    accessorFn: options.value,
    enableSorting: true,
    header: ({ column }) => (
      <SortableHeader column={column} label={options.header} />
    ),
    meta: {
      label: options.header,
      width: options.width,
      cellClassName: options.className,
    },
    cell: ({ row }) => {
      const value = options.value(row.original);
      if (!value) return <EmptyValue />;
      return options.cell ? (
        options.cell(row.original)
      ) : (
        <span className="block truncate">{value}</span>
      );
    },
  };
}

/**
 * The contacts table. Every column sorts on the server; the page adds the
 * custom field columns (useFieldColumns) after these.
 */
export function contactColumns({
  archived,
  anchorRef,
}: {
  archived: boolean;
  anchorRef: MutableRefObject<SelectionAnchor | null>;
}): ColumnDef<ContactRow>[] {
  return [
    makeSelectionColumn(anchorRef, (row) => `Select ${fullName(row.original)}`),
    {
      id: "name",
      accessorFn: (row) => fullName(row),
      enableSorting: true,
      enableHiding: false,
      header: ({ column }) => <SortableHeader column={column} label="Name" />,
      meta: { label: "Name", width: "w-[20%]" },
      cell: ({ row }) => {
        const contact = row.original;
        const name = fullName(contact);
        return (
          <div className="min-w-0 space-y-0.5">
            <RecordLink
              record={{ kind: "contact", id: contact.id }}
              className="block"
            >
              <NameCell
                media={
                  <PersonAvatar src={contact.imageUrl} name={name} size="sm" />
                }
                name={name}
              />
            </RecordLink>
            {hasAgentNote(contact) ? (
              <div className="pl-7.5">
                <EnrichmentIndicator
                  status={contact.enrichmentStatus}
                  queued={contact.queued}
                  waiting={contact.waiting}
                />
              </div>
            ) : null}
          </div>
        );
      },
    },
    sortableColumn({
      id: "title",
      header: "Title",
      value: (row) => row.title,
      width: "w-[17%]",
    }),
    sortableColumn({
      id: "email",
      header: "Email",
      value: (row) => row.email,
      width: "w-[20%]",
      className: "text-muted-foreground",
    }),
    sortableColumn({
      id: "company",
      header: "Company",
      value: (row) => row.company?.name ?? null,
      width: "w-[17%]",
      cell: ({ company }) =>
        company ? (
          <span className="flex min-w-0 items-center gap-2">
            <EntityLogo
              src={company.iconUrl ?? company.logoUrl}
              darkSrc={company.iconDarkUrl}
              tone={company.iconTone}
              name={company.name}
              size="sm"
            />
            <span className="truncate">{company.name}</span>
          </span>
        ) : null,
    }),
    ownerColumn("w-[14%]"),
    dateColumn({
      id: "lastActivity",
      header: "Last activity",
      value: (row) => row.lastActivityAt,
      sortable: true,
      width: "w-[12%]",
    }),
    ...recordDateColumns<ContactRow>(archived),
  ];
}
