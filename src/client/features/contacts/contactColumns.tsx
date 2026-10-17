import type { MutableRefObject, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { cn } from "cn";
import { SortableHeader } from "@/client/components/table/SortableHeader";
import { makeSelectionColumn } from "@/client/components/table/DataTable";
import type { SelectionAnchor } from "@/client/components/table/tableSelection";
import { fullName } from "@/client/features/companies/companyFormat";
import type { ContactRow } from "@/client/features/contacts/contactFormat";
import {
  EnrichmentIndicator,
  isEnriching,
} from "@/client/features/records/EnrichmentStatus";
import {
  EmptyValue,
  EntityLogo,
  NameCell,
  PersonAvatar,
  dateColumn,
  ownerColumn,
} from "@/client/features/records/cells";

/**
 * A text column the server sorts, blanks last either way. Its value doubles
 * as the accessor: the table only sorts a column with one.
 */
function sortableColumn(options: {
  id: "title" | "email" | "company";
  header: string;
  value: (row: ContactRow) => string | null;
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
    meta: { cellClassName: cn("max-w-56", options.className) },
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
 * The contacts table. Name, title, email, company, last activity and created
 * date sort on the server; the page adds the custom field columns
 * (useFieldColumns) after these.
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
      header: ({ column }) => <SortableHeader column={column} label="Name" />,
      meta: { cellClassName: "max-w-72" },
      cell: ({ row }) => {
        const contact = row.original;
        const name = fullName(contact);
        return (
          <div className="min-w-0 space-y-0.5">
            <Link
              from="/contacts"
              to="/contacts"
              search={(prev) => ({
                ...prev,
                record: contact.id,
                tab: undefined,
              })}
              // The row opens it too; one navigation is enough.
              onClick={(event) => event.stopPropagation()}
              className="block min-w-0 underline-offset-4 hover:underline"
            >
              <NameCell
                media={
                  <PersonAvatar src={contact.imageUrl} name={name} size="sm" />
                }
                name={name}
              />
            </Link>
            {isEnriching(contact.enrichmentStatus, contact.queued) ? (
              <div className="pl-7.5">
                <EnrichmentIndicator
                  status={contact.enrichmentStatus}
                  queued={contact.queued}
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
    }),
    sortableColumn({
      id: "email",
      header: "Email",
      value: (row) => row.email,
      className: "text-muted-foreground",
    }),
    sortableColumn({
      id: "company",
      header: "Company",
      value: (row) => row.company?.name ?? null,
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
    ownerColumn(),
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
