import type {
  Settlement,
  SyncRow,
} from "@/server/features/mailbox/repositories/SyncStateRepository";
import type { MatchContext } from "@/server/features/mailbox/services/MatchService";
import type { CaptureJob } from "@/server/features/mailbox/services/CaptureService";
import type { CallBudget, MailboxFailure } from "./mailboxApi";

// What a source's check (gmail.ts, calendar.ts, outlook.ts) is given and how
// it ends. The orchestrator (MailboxSyncService) settles the row with it.

export type SyncJob = {
  row: SyncRow;
  accessToken: string;
  capture: CaptureJob;
  budget: CallBudget;
  /** Who "we" are, loaded once per check, only when something needs filing. */
  context: () => Promise<MatchContext>;
};

/** A settlement, or the provider refusing the access token (refresh it next time). */
export type SyncResult =
  | Settlement
  | { status: "UNAUTHORIZED"; reason: string; cursor?: string | null };

/** The settlement for a failed provider call, keeping `cursor` as progress. */
export function failureOf(
  failure: MailboxFailure,
  cursor?: string | null,
): SyncResult {
  switch (failure.outcome) {
    case "unauthorized":
      return { status: "UNAUTHORIZED", reason: failure.reason, cursor };
    case "rate-limited":
      return {
        status: "RATE_LIMITED",
        reason: failure.reason,
        retryAfterMs: failure.retryAfterMs,
        cursor,
      };
    case "cursor-invalid":
    case "failed":
      return { status: "FAILED", reason: failure.reason, cursor };
  }
}

/** Lazily loads a value once. */
export function once<T>(load: () => Promise<T>): () => Promise<T> {
  let loaded: Promise<T> | null = null;
  return () => (loaded ??= load());
}
