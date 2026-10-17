import { useRef, useState, type ReactNode } from "react";
import { ArrowLeft, XIcon } from "lucide-react";
import { EmptyState } from "@/client/components/EmptyState";
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
import { RecordAgentPanel } from "@/client/features/agent/RecordAgentPanel";
import {
  RECORD_TABS,
  useRecordStack,
  useRecordTab,
  type RecordTab,
} from "@/client/features/records/recordStack";
import type { RecordRef } from "@/shared/records";

// A record opens in a sheet over the page it was opened from
// (RecordSheetHost). The shell is the same for companies, contacts and
// deals: a header with Back (when it sits on another record's sheet), the
// record's picture, name, status and actions, and Close; optional stats; and
// three tabs: the record's own Overview, its Activity timeline and its Agent.

export function RecordSheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
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
}: {
  record: RecordRef;
  header: RecordHeader | undefined;
  error?: ReactNode;
  stats?: ReactNode;
  overview: ReactNode;
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
        <div className="min-w-0 flex-1 space-y-1">
          <SheetTitle className="text-lg leading-snug font-semibold [overflow-wrap:anywhere]">
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
                <SheetDescription className="[overflow-wrap:anywhere]">
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
          {stats}
          <RecordTabs
            record={record}
            tab={tab}
            onTabChange={setTab}
            overview={overview}
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

const TAB_LABELS: Record<RecordTab, string> = {
  overview: "Overview",
  activity: "Activity",
  agent: "Agent",
};

function RecordTabs({
  record,
  tab,
  onTabChange,
  overview,
}: {
  record: RecordRef;
  tab: RecordTab;
  onTabChange: (tab: RecordTab) => void;
  overview: ReactNode;
}) {
  // The agent's chat keeps its connection once opened, so switching tabs
  // doesn't drop a conversation.
  const [agentOpened, setAgentOpened] = useState(tab === "agent");
  if (tab === "agent" && !agentOpened) setAgentOpened(true);

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        const next = RECORD_TABS.find((candidate) => candidate === value);
        if (next) onTabChange(next);
      }}
      className="min-h-0 flex-1 gap-0"
    >
      <TabsList
        variant="line"
        className="w-full shrink-0 justify-start gap-6 border-b border-border px-5 *:flex-none"
      >
        {RECORD_TABS.map((value) => (
          <TabsTrigger key={value} value={value}>
            {TAB_LABELS[value]}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="overview" className="min-h-0 overflow-y-auto">
        {overview}
      </TabsContent>
      <TabsContent value="activity" className="min-h-0 overflow-y-auto">
        <RecordTimeline record={record} />
      </TabsContent>
      <TabsContent
        value="agent"
        keepMounted={agentOpened}
        className="min-h-0 overflow-y-auto"
      >
        {agentOpened ? <RecordAgentPanel record={record} /> : null}
      </TabsContent>
    </Tabs>
  );
}

/** One section of a record's Overview, with an optional heading action. */
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
    <section className="space-y-2 border-b border-border px-5 py-4 last:border-b-0">
      {title || action ? (
        <div className="flex min-h-6 items-center justify-between gap-3">
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

/** A short "nothing here yet" inside a section. */
export function SheetEmpty({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <EmptyState
      variant="plain"
      size="sm"
      icon={null}
      title={title}
      description={description}
      action={action}
    />
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
