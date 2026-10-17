import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Handshake } from "lucide-react";
import { cn } from "cn";
import { QueryError } from "@/client/components/QueryState";
import { Button } from "@/client/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/client/components/ui/collapsible";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { RecordLink } from "@/client/features/records/RecordLink";
import { EntityLogo, PersonAvatar } from "@/client/features/records/cells";
import type { getEnrichmentQueue } from "@/serverFunctions/agent";
import { ENRICHMENT_PAGE, ENRICHMENT_PAGE_MAX } from "@/types/schemas/agent";
import {
  AgentSetupLink,
  agentPausedReason,
  useAgentAvailability,
} from "./AgentPaused";
import { enrichmentQueueQueryOptions } from "./agentQueries";
import {
  dueLabel,
  elapsedLabel,
  queueFooter,
  queueLine,
  useSeconds,
  type QueueState,
} from "./enrichmentCopy";

type Queue = Awaited<ReturnType<typeof getEnrichmentQueue>>;
type QueueRow = Queue["rows"][number];
type ScheduledRow = Queue["scheduled"][number];
type Subject = QueueRow["subject"];

const VISIBLE_ROWS = 5;

const STATE_DOTS: Record<QueueState, string> = {
  running: "animate-pulse bg-info",
  queued: "bg-muted-foreground/60",
  failed: "bg-destructive",
  waiting: "bg-warning",
};

const ROW_LINK =
  "flex w-full items-center gap-3 px-4 hover:bg-muted hover:no-underline focus-visible:bg-muted focus-visible:outline-none";

/**
 * What the research agent is working on for the organization, and what it
 * has booked for later (the CRM's EnrichmentQueue): a button with the count,
 * opening the list. Each row opens its record. While the agent's model isn't
 * set up, the button says the agent is paused and the list says why.
 */
export function EnrichmentQueue() {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [limit, setLimit] = useState(ENRICHMENT_PAGE);
  const queue = useQuery(enrichmentQueueQueryOptions(limit));

  const availability = useAgentAvailability();
  const rows = queue.data?.rows ?? [];
  const total = queue.data?.total ?? 0;
  const paused = queue.data?.paused ?? false;
  const visible = expanded ? rows : rows.slice(0, VISIBLE_ROWS);
  const footer = queueFooter({
    total,
    fetched: rows.length,
    shown: visible.length,
    limit,
  });

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) return;
        setExpanded(false);
        setLimit(ENRICHMENT_PAGE);
      }}
    >
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            paused
              ? STATE_DOTS.waiting
              : total > 0
                ? STATE_DOTS.running
                : STATE_DOTS.queued,
          )}
        />
        {paused ? "Agent paused" : total > 0 ? `Enriching ${total}` : "Enriching"}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <PopoverTitle>
            {paused ? "The agent is paused" : "Enriching now"}
          </PopoverTitle>
          <span className="font-mono text-xs text-muted-foreground">
            {total}
          </span>
        </div>
        {paused ? (
          <div className="space-y-1.5 border-b border-border px-4 py-3 text-xs">
            <p className="text-muted-foreground">
              {availability
                ? agentPausedReason(availability)
                : "The agent's model isn't set up."}{" "}
              {total > 0
                ? "The records below wait until it is."
                : "New records will wait until it is."}
            </p>
            <AgentSetupLink className="text-foreground underline underline-offset-4" />
          </div>
        ) : null}

        {queue.isError && !queue.data ? (
          <div className="px-4 py-3">
            <QueryError
              variant="inline"
              error={queue.error}
              fallback="The agent's queue could not be loaded."
              onRetry={() => void queue.refetch()}
              isRetrying={queue.isFetching}
            />
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col gap-1 px-6 py-8 text-center">
            <span className="text-sm font-medium">Nothing right now</span>
            <span className="text-xs text-muted-foreground">
              {paused
                ? "New companies and contacts show up here, waiting for the agent."
                : "New companies and contacts show up here while the agent looks them up."}
            </span>
          </div>
        ) : (
          <ul className={cn(expanded && "max-h-80 overflow-y-auto")}>
            {visible.map((row) => (
              <QueueRowLink key={row.id} row={row} />
            ))}
          </ul>
        )}

        {footer.more > 0 ? (
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs">
            <span className="text-muted-foreground">
              {footer.more} more {paused ? "waiting" : "queued"}
            </span>
            {footer.action === "show-all" ? (
              <Button
                variant="link"
                size="xs"
                className="h-auto px-0"
                onClick={() => setExpanded(true)}
              >
                Show all
              </Button>
            ) : footer.action === "load-more" ? (
              <Button
                variant="link"
                size="xs"
                className="h-auto px-0"
                pending={queue.isFetching}
                onClick={() => {
                  setExpanded(true);
                  setLimit((current) =>
                    Math.min(current + ENRICHMENT_PAGE, ENRICHMENT_PAGE_MAX),
                  );
                }}
              >
                Load more
              </Button>
            ) : null}
          </div>
        ) : null}

        {queue.data && queue.data.scheduledTotal > 0 ? (
          <Booked
            rows={queue.data.scheduled}
            total={queue.data.scheduledTotal}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function QueueRowLink({ row }: { row: QueueRow }) {
  const now = useSeconds();
  return (
    <li className="border-b border-border last:border-b-0">
      <RecordLink
        record={{ kind: row.subject.kind, id: row.subject.id }}
        className={cn(ROW_LINK, "group py-3")}
      >
        <SubjectFace subject={row.subject} />
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="truncate text-sm font-medium">
            {row.subject.name}
          </span>
          <span
            className={cn(
              "truncate text-xs",
              row.state === "failed"
                ? "text-destructive"
                : "text-muted-foreground",
            )}
          >
            {queueLine(row.state, row.kind)}
          </span>
        </span>
        <span className="flex shrink-0 items-center justify-end gap-2">
          <span className="font-mono text-xs text-muted-foreground group-hover:hidden">
            {elapsedLabel(row.state, row.startedAt, now)}
          </span>
          <ChevronRight
            aria-hidden
            className="hidden size-3.5 text-muted-foreground group-hover:block"
          />
          <span
            aria-hidden
            className={cn("size-1.5 rounded-full", STATE_DOTS[row.state])}
          />
        </span>
      </RecordLink>
    </li>
  );
}

/** Records the agent has booked a later look at, soonest first. */
function Booked({ rows, total }: { rows: ScheduledRow[]; total: number }) {
  const now = useSeconds();
  return (
    <Collapsible className="border-t border-border">
      <CollapsibleTrigger className="group flex w-full cursor-pointer items-center justify-between px-4 py-3 text-xs outline-none hover:bg-muted focus-visible:bg-muted">
        <span className="text-muted-foreground">
          {total === 1
            ? "1 record is booked for a later look"
            : `${total} records are booked for a later look`}
        </span>
        <span className="text-primary group-data-panel-open:hidden">Show</span>
        <span className="hidden text-primary group-data-panel-open:inline">
          Hide
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="max-h-60 overflow-y-auto border-t border-border">
        <ul>
          {rows.map((row) => (
            <li key={row.id} className="border-b border-border last:border-b-0">
              <RecordLink
                record={{ kind: row.subject.kind, id: row.subject.id }}
                className={cn(ROW_LINK, "py-2.5")}
              >
                <SubjectFace subject={row.subject} />
                <span
                  className="min-w-0 flex-1 truncate text-sm text-muted-foreground"
                  title={row.reason}
                >
                  {row.subject.name}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {dueLabel(row.dueAt, now)}
                </span>
              </RecordLink>
            </li>
          ))}
        </ul>
        {total > rows.length ? (
          <p className="px-4 py-3 text-xs text-muted-foreground">
            {total - rows.length} more are booked but not listed here
          </p>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

function SubjectFace({ subject }: { subject: Subject }) {
  if (subject.kind === "contact") {
    return <PersonAvatar src={subject.imageUrl} name={subject.name} />;
  }
  if (subject.kind === "company") {
    return (
      <EntityLogo
        src={subject.logoUrl}
        darkSrc={subject.logoDarkUrl}
        tone={subject.logoTone}
        name={subject.name}
      />
    );
  }
  return (
    <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
      <Handshake aria-hidden className="size-3.5" />
    </span>
  );
}
