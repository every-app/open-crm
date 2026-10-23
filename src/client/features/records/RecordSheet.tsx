import { useRef, Fragment, type ReactNode } from "react";
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/client/components/ui/tabs";
import { RecordTimeline } from "@/client/features/activities/RecordTimeline";
import { ArchivedRecordNotice } from "./ArchivedRecordNotice";
import {
  useRecordStack,
  useRecordTab,
  type RecordTab,
} from "@/client/features/records/recordStack";
import type { RecordRef } from "@/shared/records";

// A record opens in a sheet over the page it was opened from
// (RecordSheetHost). The shell is the same for companies, contacts and
// deals: a header with Back (when it sits on another record's sheet), the
// record's picture, name, status and actions, and Close; optional stats; and
// two tabs: Details with related records, and the Activity timeline.

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
  /** A status line: enrichment, "Archived". */
  note?: ReactNode;
  actions?: ReactNode;
};

/** A related-record section appended to Details. */
type RelatedSection = {
  value: "contacts" | "deals";
  content: ReactNode;
};

/**
 * A record's header and tabs. `header` is undefined while the record loads
 * or when it couldn't be loaded (`error`, a QueryError).
 */
export function RecordSheetFrame({
  record,
  header,
  error,
  stats,
  overview,
  lists = [],
  archivedAt,
}: {
  record: RecordRef;
  header: RecordHeader | undefined;
  error?: ReactNode;
  stats?: ReactNode;
  overview: ReactNode;
  lists?: RelatedSection[];
  archivedAt?: string | null;
}) {
  const { stack, back, close } = useRecordStack();
  const [tab, setTab] = useRecordTab();
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
        {header ? header.media : <Skeleton className="size-10 rounded-md" />}
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
          {archivedAt ? <ArchivedRecordNotice archivedAt={archivedAt} /> : null}
          {stats}
          <RecordTabs
            record={record}
            tab={tab}
            onTabChange={setTab}
            overview={overview}
            lists={lists}
          />
        </>
      ) : error ? (
        <div className="p-5">{error}</div>
      ) : (
        <SkeletonTableRows className="p-5" rows={6} columns={2} />
      )}
    </>
  );
}

function RecordTabs({
  record,
  tab,
  onTabChange,
  overview,
  lists,
}: {
  record: RecordRef;
  tab: RecordTab;
  onTabChange: (tab: RecordTab) => void;
  overview: ReactNode;
  lists: RelatedSection[];
}) {
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        if (value === "details") onTabChange("details");
        else if (value === "activity") onTabChange("activity");
      }}
      className="min-h-0 flex-1 gap-0"
    >
      <TabsList
        variant="line"
        className="w-full shrink-0 justify-start gap-6 border-b border-border px-5"
      >
        <TabsTrigger value="details">Details</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
      </TabsList>
      <TabsContent value="details" className="min-h-0 overflow-y-auto">
        {overview}
        {lists.map((list) => (
          <Fragment key={list.value}>{list.content}</Fragment>
        ))}
      </TabsContent>
      <TabsContent value="activity" className="min-h-0 overflow-y-auto">
        <RecordTimeline record={record} />
      </TabsContent>
    </Tabs>
  );
}

/** One section of a record's details, with an optional heading action. */
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
    <section className="space-y-2 border-b border-border px-5 py-3 last:border-b-0">
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

/** The figures under a record's header: two by two on a phone. */
export function SheetStats({ children }: { children: ReactNode }) {
  return (
    <dl className="grid shrink-0 grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-4">
      {children}
    </dl>
  );
}

export function SheetStat({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 bg-popover px-5 py-2.5">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-sm font-medium">{children}</dd>
    </div>
  );
}
