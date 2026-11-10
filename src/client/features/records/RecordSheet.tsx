import { useRef, type ReactNode } from "react";
import { ArrowLeft, XIcon } from "lucide-react";
import { SkeletonTableRows } from "@/client/components/SkeletonPresets";
import { Button } from "@/client/components/ui/button";
import { Separator } from "@/client/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/client/components/ui/sheet";
import { Skeleton } from "@/client/components/ui/skeleton";
import { RecordTimeline } from "@/client/features/activities/RecordTimeline";
import { ArchivedRecordNotice } from "./ArchivedRecordNotice";
import { useRecordStack } from "@/client/features/records/recordStack";
import type { RecordRef } from "@/shared/records";

// A record opens in a sheet over the page it was opened from
// (RecordSheetHost). The shell is the same for companies, contacts and
// deals: a header with Back (when it sits on another record's sheet), the
// record's picture, name, status and actions, and Close; then one scroll of
// the record's sections and, under them, its timeline.

export function RecordSheet({
  open,
  onClose,
  onFocus,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Focus moved into the sheet, as it does when the sheet opens. */
  onFocus?: () => void;
  children: ReactNode;
}) {
  // The sheet itself takes focus as it opens, not its first button: Tab
  // reaches its controls from there.
  const popup = useRef<HTMLDivElement>(null);
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent
        ref={popup}
        initialFocus={popup}
        onFocus={onFocus}
        side="right"
        showCloseButton={false}
        className="gap-0 p-0 outline-none data-[side=right]:w-full data-[side=right]:sm:max-w-2xl"
      >
        {children}
      </SheetContent>
    </Sheet>
  );
}

type RecordHeader = {
  media: ReactNode;
  title: string;
  /** Under the name: the domain, location and industry, for example. */
  description?: ReactNode;
  /** A status line: "Archived". */
  note?: ReactNode;
  actions?: ReactNode;
};

/**
 * A record's header, sections (`children`) and timeline. `header` is
 * undefined while the record loads or when it couldn't be loaded (`error`, a
 * QueryError).
 */
export function RecordSheetFrame({
  record,
  header,
  error,
  archived,
  children,
}: {
  record: RecordRef;
  header: RecordHeader | undefined;
  error?: ReactNode;
  /** An archived record: when it was archived, and the way back. */
  archived?: { at: string; restoring: boolean; onRestore: () => void };
  children: ReactNode;
}) {
  const { stack, back, close } = useRecordStack();
  return (
    <>
      <div className="flex shrink-0 items-start gap-3 border-b border-border px-5 py-3">
        {stack.length > 1 ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Back"
            onClick={back}
          >
            <ArrowLeft />
          </Button>
        ) : null}
        {header ? (
          header.media
        ) : error ? null : (
          <Skeleton className="size-10 rounded-md" />
        )}
        <div className="min-w-0 flex-1 space-y-0.5 pt-0.5">
          <SheetTitle className="text-lg leading-tight font-semibold [overflow-wrap:anywhere]">
            {header ? (
              header.title
            ) : (
              <span className="sr-only">
                {error ? `The ${record.kind} could not be loaded` : "Loading"}
              </span>
            )}
          </SheetTitle>
          {header ? (
            <>
              {header.description ? (
                // One line: what it would wrap (a location, an industry) is in
                // Details too.
                <SheetDescription className="truncate">
                  {header.description}
                </SheetDescription>
              ) : null}
              {header.note ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {header.note}
                </div>
              ) : null}
            </>
          ) : error ? null : (
            <Skeleton className="h-4 w-48" />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {header?.actions ? (
            <>
              {header.actions}
              <Separator orientation="vertical" className="mx-1 h-5" />
            </>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close"
            onClick={close}
          >
            <XIcon />
          </Button>
        </div>
      </div>
      {header ? (
        <>
          {archived ? (
            <ArchivedRecordNotice
              archivedAt={archived.at}
              restoring={archived.restoring}
              onRestore={archived.onRestore}
            />
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {children}
            <RecordTimeline record={record} />
          </div>
        </>
      ) : error ? (
        <div className="p-5">{error}</div>
      ) : (
        <SkeletonTableRows className="p-5" rows={6} columns={2} />
      )}
    </>
  );
}

/** One section of a record's sheet, with an optional heading action. */
export function SheetSection({
  title,
  action,
  children,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2 border-b border-border px-5 py-3">
      {title || action ? (
        <div className="flex min-h-5 items-center justify-between gap-3">
          {title ? (
            <h3 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
              {title}
            </h3>
          ) : (
            <span />
          )}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/**
 * The adds for what a record has none of yet (a list, a contact, a deal), in
 * one quiet row: each one's section shows once there is something in it.
 * Takes no room when there is nothing to add.
 */
export function SheetAdds({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-border px-3 py-2 empty:hidden">
      {children}
    </div>
  );
}
