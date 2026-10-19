import type { ColumnDef } from "@tanstack/react-table";
import { SortableHeader } from "@/client/components/table/SortableHeader";
import {
  roleLabel,
  roleRank,
  type Member,
} from "@/client/features/members/memberRoles";
import { PersonAvatar } from "@/client/features/records/cells";
import { RelativeTime } from "@/client/features/records/LocalDateTime";

/**
 * Settings → Members' columns, as the CRM's members table has them: the
 * email hides below `md` and the joined date below `sm`, and the Columns menu
 * hides any but the name.
 */
export function memberColumns(viewerId: string | null): ColumnDef<Member>[] {
  return [
    {
      id: "name",
      accessorFn: (member) => member.name,
      sortingFn: "text",
      enableHiding: false,
      header: ({ column }) => <SortableHeader column={column} label="Name" />,
      cell: ({ row }) => (
        <span className="flex min-w-0 items-center gap-2">
          <PersonAvatar
            src={row.original.image}
            name={row.original.name}
            size="sm"
          />
          <span className="truncate font-medium">{row.original.name}</span>
          {row.original.userId === viewerId ? (
            <span className="text-xs text-muted-foreground">You</span>
          ) : null}
        </span>
      ),
    },
    {
      id: "email",
      accessorFn: (member) => member.email,
      sortingFn: "text",
      header: ({ column }) => <SortableHeader column={column} label="Email" />,
      cell: ({ row }) => (
        <span className="text-muted-foreground">{row.original.email}</span>
      ),
      meta: {
        label: "Email",
        headerClassName: "hidden md:table-cell",
        cellClassName: "hidden md:table-cell",
      },
    },
    {
      id: "role",
      accessorFn: roleRank,
      sortDescFirst: false,
      header: ({ column }) => <SortableHeader column={column} label="Role" />,
      cell: ({ row }) => (
        <span className="text-muted-foreground">{roleLabel(row.original)}</span>
      ),
      meta: { label: "Role" },
    },
    {
      id: "joinedAt",
      accessorFn: (member) => member.joinedAt,
      sortingFn: "basic",
      sortDescFirst: false,
      header: ({ column }) => (
        <SortableHeader column={column} label="Joined" align="right" />
      ),
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          <RelativeTime date={row.original.joinedAt} />
        </span>
      ),
      meta: {
        label: "Joined date",
        headerClassName: "hidden text-right sm:table-cell",
        cellClassName: "hidden text-right sm:table-cell",
      },
    },
  ];
}
