import { cn } from "cn";
import type { EnrichmentStatus } from "@/shared/crm-enums";

// Where the research agent is with a company or a contact. The agent writes
// in the background, so lists and sheets poll while it works.

/** How often a list or sheet refetches while the agent works on a record. */
const ENRICHMENT_POLL_MS = 3_000;

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

const DOT: Record<Tone, string> = {
  neutral: "bg-muted-foreground/60",
  info: "bg-info",
  success: "bg-success",
  error: "bg-destructive",
};

/** The agent is on it: running, or queued for a record it hasn't started. */
export function isEnriching(status: EnrichmentStatus, queued: boolean) {
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

export function EnrichmentIndicator({
  status,
  queued,
  title,
}: {
  status: EnrichmentStatus;
  queued: boolean;
  /** Why it failed, on hover. */
  title?: string | null;
}) {
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
