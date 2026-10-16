import { useState, type ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { cn } from "cn";
import { SortableHeader } from "@/client/components/table/SortableHeader";
import { RelativeTime } from "@/client/features/records/LocalDateTime";
import { safeHttpUrl } from "@/shared/safe-url";

// The parts of a record list's rows and a record sheet's header: logos,
// avatars, owners, blanks, and the column definitions lists share.

export type Owner = {
  id: string;
  name: string;
  email: string;
  image: string | null;
};

/** "Ana Zed" is "AZ"; a single word gives its first two letters. */
function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return "?";
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  return (
    last ? first.slice(0, 1) + last.slice(0, 1) : first.slice(0, 2)
  ).toUpperCase();
}

/**
 * An image the app may show: a copy the agent stored (served under
 * /api/images/), or an http(s) URL.
 */
function safeImageUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith("/api/images/")) return value;
  return safeHttpUrl(value);
}

const SIZE = {
  sm: "size-5 text-[9px]",
  md: "size-6 text-[10px]",
  lg: "size-10 text-sm",
} as const;

type Size = keyof typeof SIZE;

// A one-colour logo drawn for a light (or dark) background, inverted for
// the other theme. "opaque" art stays as it is.
const TONE: Record<string, string> = {
  dark: "dark:invert",
  light: "invert dark:invert-0",
};

/** A picture that falls back to `fallback` when it's missing or broken. */
function Picture({
  src,
  className,
  fallback,
}: {
  src: string | null;
  className?: string;
  fallback: ReactNode;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) return fallback;
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(src)}
      className={className}
    />
  );
}

/** A company's logo, or its initials until (or unless) the agent finds one. */
export function EntityLogo({
  src,
  darkSrc,
  tone,
  name,
  size = "md",
}: {
  src: string | null | undefined;
  darkSrc?: string | null;
  tone?: string | null;
  name: string;
  size?: Size;
}) {
  const light = safeImageUrl(src);
  const dark = safeImageUrl(darkSrc);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md font-medium text-muted-foreground uppercase select-none",
        SIZE[size],
        !light && "bg-muted",
      )}
    >
      <Picture
        src={light}
        className={cn(
          "size-full object-contain",
          dark ? "dark:hidden" : tone ? TONE[tone] : undefined,
        )}
        fallback={initials(name)}
      />
      {light && dark ? (
        <Picture
          src={dark}
          className="hidden size-full object-contain dark:block"
          fallback={null}
        />
      ) : null}
    </span>
  );
}

/** A person's photograph, or their initials. */
export function PersonAvatar({
  src,
  name,
  size = "md",
}: {
  src: string | null | undefined;
  name: string;
  size?: Size;
}) {
  const url = safeImageUrl(src);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-medium text-muted-foreground uppercase select-none",
        SIZE[size],
        !url && "bg-muted",
      )}
    >
      <Picture
        src={url}
        className="size-full object-cover"
        fallback={initials(name)}
      />
    </span>
  );
}

/** A value nobody has filled in. */
export function EmptyValue() {
  return (
    <span className="text-muted-foreground">
      <span aria-hidden>—</span>
      <span className="sr-only">None</span>
    </span>
  );
}

export function OwnerCell({ owner }: { owner: Owner | null }) {
  if (!owner) return <EmptyValue />;
  return (
    <span className="flex min-w-0 items-center gap-2" title={owner.email}>
      <PersonAvatar src={owner.image} name={owner.name} size="sm" />
      <span className="truncate">{owner.name}</span>
    </span>
  );
}

/** A record's picture and name, as the first cell of its row. */
export function NameCell({ media, name }: { media: ReactNode; name: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      {media}
      <span className="truncate font-medium">{name}</span>
    </span>
  );
}

/** A plain text column, with a dash for blanks. */
export function textColumn<TRow>(options: {
  id: string;
  header: string;
  value: (row: TRow) => string | null;
  className?: string;
}): ColumnDef<TRow> {
  return {
    id: options.id,
    header: options.header,
    enableSorting: false,
    meta: { cellClassName: cn("max-w-56", options.className) },
    cell: ({ row }) => {
      const value = options.value(row.original);
      return value ? (
        <span className="block truncate">{value}</span>
      ) : (
        <EmptyValue />
      );
    },
  };
}

export function ownerColumn<
  TRow extends { owner: Owner | null },
>(): ColumnDef<TRow> {
  return {
    id: "owner",
    header: "Owner",
    enableSorting: false,
    meta: { cellClassName: "max-w-48" },
    cell: ({ row }) => <OwnerCell owner={row.original.owner} />,
  };
}

/** A right-aligned count, such as a company's contacts. */
export function countColumn<TRow>(options: {
  id: string;
  header: string;
  value: (row: TRow) => number;
}): ColumnDef<TRow> {
  return {
    id: options.id,
    header: options.header,
    enableSorting: false,
    meta: { headerClassName: "text-right", cellClassName: "text-right" },
    cell: ({ row }) => (
      <span className="tabular-nums">{options.value(row.original)}</span>
    ),
  };
}

/** "3 days ago", newest first when sorted; blanks show a dash. */
export function dateColumn<TRow>(options: {
  id: string;
  header: string;
  value: (row: TRow) => string | null;
  sortable?: boolean;
}): ColumnDef<TRow> {
  return {
    id: options.id,
    // The table only sorts (here: asks the server to) a column with a value.
    accessorFn: options.value,
    enableSorting: options.sortable ?? false,
    sortDescFirst: true,
    header: ({ column }) =>
      options.sortable ? (
        <SortableHeader column={column} label={options.header} align="right" />
      ) : (
        <span className="flex justify-end">{options.header}</span>
      ),
    meta: {
      cellClassName: "text-right whitespace-nowrap text-muted-foreground",
    },
    cell: ({ row }) => {
      const value = options.value(row.original);
      return value ? <RelativeTime date={value} /> : <EmptyValue />;
    },
  };
}
