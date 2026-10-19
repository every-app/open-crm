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

/**
 * Files a check's messages or meetings one at a time. One that fails twice
 * (the second try rides out a passing database error) is logged by its id
 * alone, as an error's text can carry what it holds, and is passed over once
 * a later one is filed: the fault was its own, so a crafted message can't
 * hold its mailbox back. Until then the check keeps its place before that
 * one, so a database that is down loses nothing.
 */
export function createFiler(job: SyncJob) {
  let held: { cursor: string | null } | null = null;
  const reason = `A ${job.row.source === "calendar" ? "meeting" : "message"} could not be stored; the next check retries it.`;
  return {
    /** Files one item; `cursor` is where its check resumes while it fails. */
    async file(
      id: string | null | undefined,
      cursor: string | null,
      write: () => Promise<unknown>,
    ): Promise<void> {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await write();
          held = null;
          return;
        } catch {
          // Logged below, by id alone, once it has failed twice.
        }
      }
      held ??= { cursor };
      console.error("[mailbox] could not store an item", {
        organizationId: job.row.organizationId,
        userId: job.row.userId,
        source: job.row.source,
        id: id ?? null,
      });
    },
    /** `cursor`, or where an item still failing started. */
    place(cursor: string | null): string | null {
      return held ? held.cursor : cursor;
    },
    /** The check's end, having reached `cursor`. */
    end(cursor: string | null): SyncResult {
      return held
        ? { status: "FAILED", reason, cursor: held.cursor }
        : { status: "IDLE", cursor };
    },
  };
}

/** Lazily loads a value once. */
export function once<T>(load: () => Promise<T>): () => Promise<T> {
  let loaded: Promise<T> | null = null;
  return () => (loaded ??= load());
}
