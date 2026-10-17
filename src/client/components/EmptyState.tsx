import type { ReactNode } from "react";
import { CircleAlert, Inbox, SearchX, type LucideIcon } from "lucide-react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/client/components/ui/empty";

const KIND_ICONS: Record<EmptyStateKind, LucideIcon> = {
  "no-data": Inbox,
  filtered: SearchX,
  error: CircleAlert,
};

type EmptyStateKind = "no-data" | "filtered" | "error";

/**
 * The one empty state: an icon, a title, a body and an action.
 *
 * `kind` picks the default icon. Say why the region is empty: "no-data" when
 * nothing exists yet, "filtered" when filters hide every row, "error" when the
 * data failed to load. Name only filters and buttons that exist on the page.
 * A list that has nothing in it yet passes `media="rows"`: a few faded rows
 * of the list, each with its icon, stand in for the ones to come.
 */
export function EmptyState({
  kind = "no-data",
  icon: Icon = KIND_ICONS[kind],
  title,
  description,
  action,
  variant = "dashed",
  size,
  media = "icon",
}: {
  kind?: EmptyStateKind;
  /** Pass `null` for a text-only empty state. */
  icon?: LucideIcon | null;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** `dashed` for sections and lists, `card` for a whole panel, `plain` inside a card or table. */
  variant?: "dashed" | "card" | "plain";
  size?: "sm" | "default" | "lg";
  media?: "icon" | "rows";
}) {
  return (
    <Empty
      variant={variant}
      size={size}
      role={kind === "error" ? "alert" : undefined}
    >
      <EmptyHeader>
        {Icon && media === "rows" ? (
          <EmptyRows icon={Icon} />
        ) : Icon ? (
          <EmptyMedia
            variant="icon"
            className={
              kind === "error"
                ? "bg-destructive/10 text-destructive"
                : undefined
            }
          >
            <Icon aria-hidden />
          </EmptyMedia>
        ) : null}
        <EmptyTitle>{title}</EmptyTitle>
        {description ? (
          <EmptyDescription>{description}</EmptyDescription>
        ) : null}
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}

const ROWS = [
  { name: "w-28", meta: ["w-10", "w-12"] },
  { name: "w-36", meta: ["w-8", "w-14"] },
  { name: "w-24", meta: ["w-12", "w-10"] },
];

/** Three faded placeholder rows of a list, each led by the list's icon. */
function EmptyRows({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <div
      aria-hidden
      className="mb-3 flex w-72 max-w-full flex-col gap-2 [mask-image:linear-gradient(to_bottom,transparent,black_35%,black_65%,transparent)]"
    >
      {ROWS.map((row) => (
        <div
          key={row.name}
          className="flex h-11 items-center gap-3 rounded-lg border border-border/70 bg-card px-3.5 shadow-xs"
        >
          <Icon className="size-4 shrink-0 text-muted-foreground/60" />
          <span className={`h-2 rounded-full bg-foreground/10 ${row.name}`} />
          <span className="ml-auto flex gap-2">
            {row.meta.map((width) => (
              <span
                key={width}
                className={`h-2 rounded-full bg-foreground/[0.06] ${width}`}
              />
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}
