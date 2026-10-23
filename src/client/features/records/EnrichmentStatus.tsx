import { cn } from "cn";
import { WaitingForSetup } from "@/client/features/agent/AgentPaused";
import { ENRICHMENT_STATUSES, type EnrichmentStatus } from "@/shared/crm-enums";

// Where the research agent is with a company or a contact. The agent writes
// in the background, so lists and sheets poll while it works, and only then:
// a record waiting for the agent's model to be set up isn't polled.

/**
 * How often a list or sheet refetches while the agent works on a record.
 * Each refetch runs the list's queries again, and D1 runs one at a time.
 */
const ENRICHMENT_POLL_MS = 10_000;

type Tone = "neutral" | "info" | "success" | "error";

const PRESENTATION: Record<
  EnrichmentStatus,
  { label: string; tone: Tone; busy?: boolean }
> = {
  PENDING: { label: "Not researched", tone: "neutral" },
  RUNNING: { label: "Researching", tone: "info", busy: true },
  COMPLETE: { label: "Enriched", tone: "success" },
  FAILED: { label: "Enrichment failed", tone: "error" },
  SKIPPED: { label: "Nothing found", tone: "neutral" },
};

const QUEUED = { label: "Queued", tone: "neutral" as const, busy: false };

/** The list's Enrichment filter: one choice per state, as the CRM names it. */
export const ENRICHMENT_OPTIONS = ENRICHMENT_STATUSES.map((value) => ({
  value,
  label: PRESENTATION[value].label,
}));

const DOT: Record<Tone, string> = {
  neutral: "bg-muted-foreground/60",
  info: "bg-info",
  success: "bg-success",
  error: "bg-destructive",
};

/** The agent is on it: running, or queued for a record it hasn't started. */
function isEnriching(status: EnrichmentStatus, queued: boolean) {
  return status === "RUNNING" || (status === "PENDING" && queued);
}

/** Polls while the agent works on any of `records`. */
export function enrichmentRefetchInterval(
  records: { enrichmentStatus: EnrichmentStatus; queued: boolean }[],
): number | false {
  return records.some((record) =>
    isEnriching(record.enrichmentStatus, record.queued),
  )
    ? ENRICHMENT_POLL_MS
    : false;
}

/** Worth a note in a list: the agent is on it, or waiting to be. */
export function hasAgentNote(record: {
  enrichmentStatus: EnrichmentStatus;
  queued: boolean;
  waiting: boolean;
}): boolean {
  return (
    isEnriching(record.enrichmentStatus, record.queued) ||
    (record.enrichmentStatus === "PENDING" && record.waiting)
  );
}

export function EnrichmentIndicator({
  status,
  queued,
  waiting = false,
  title,
}: {
  status: EnrichmentStatus;
  queued: boolean;
  /** Its research waits for the agent's model to be set up. */
  waiting?: boolean;
  /** Why it failed, on hover. */
  title?: string | null;
}) {
  if (status === "PENDING" && !queued && waiting) return <WaitingForSetup />;
  const { label, tone, busy } =
    status === "PENDING" && queued ? QUEUED : PRESENTATION[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
      title={title ?? undefined}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          DOT[tone],
          busy && "animate-pulse",
        )}
      />
      {label}
    </span>
  );
}
