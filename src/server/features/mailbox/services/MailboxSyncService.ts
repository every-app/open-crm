import { clientStatus } from "@/server/features/mailbox/providers/oauth";
import { syncCalendar } from "@/server/features/mailbox/providers/calendar";
import { syncGmail } from "@/server/features/mailbox/providers/gmail";
import { syncOutlook } from "@/server/features/mailbox/providers/outlook";
import type { CallBudget } from "@/server/features/mailbox/providers/mailboxApi";
import {
  once,
  type SyncJob,
  type SyncResult,
} from "@/server/features/mailbox/providers/syncJob";
import { ConnectionRepository } from "@/server/features/mailbox/repositories/ConnectionRepository";
import {
  SyncStateRepository,
  type SyncRow,
} from "@/server/features/mailbox/repositories/SyncStateRepository";
import { MatchService } from "@/server/features/mailbox/services/MatchService";
import { TokenService } from "@/server/features/mailbox/services/TokenService";
import { loggableError, UserFacingError } from "@/server/lib/errors";
import { forOrganization } from "@/server/lib/gateway-attribution";
import {
  MAILBOX_PROVIDERS,
  PROVIDER_FOR_SOURCE,
  SOURCES_BY_PROVIDER,
  type MailboxProvider,
  type SyncSource,
} from "@/shared/mailbox";
import { runLimited } from "@/server/lib/pool";

// Runs mailbox checks, ported from the CRM's MailboxSyncService: the minute
// cron's sweep across every organization, and a member's "Check now". Each
// check takes its row's lease first, so the two never run one mailbox at
// once.
//
// A Worker invocation has limits (subrequests, CPU, wall time), so a tick
// takes due rows round-robin by organization, the longest-waiting first, a
// few at a time, and stops starting checks when its shared budget of
// provider calls or its time runs out; each check stops where it got to and
// is due again in five minutes, behind whatever waited longer. One big
// mailbox gets at most its per-check cap (120 messages; a calendar read pays
// a call for each meeting it files), and a failing provider settles FAILED
// and waits its turn, so neither starves the rest.

const SYNCERS = {
  gmail: syncGmail,
  calendar: syncCalendar,
  outlook: syncOutlook,
} satisfies Record<SyncSource, (job: SyncJob) => Promise<SyncResult>>;

const SWEEP = {
  /** Rows the tick reads; it starts as many as its budget allows. */
  rows: 40,
  concurrency: 4,
  /** Provider calls (Worker subrequests) across the tick's checks. */
  calls: 400,
  /** A check isn't started with fewer calls left than this. */
  minCallsToStart: 10,
  wallMs: 50_000,
} as const;

/** One member's "Check now", per source. */
const CHECK_NOW = { calls: 150, wallMs: 25_000 } as const;

/** Runs a claimed row's check and settles it; never throws. */
async function runClaimed(row: SyncRow, budget: CallBudget): Promise<void> {
  const { organizationId, userId } = row;
  const provider = PROVIDER_FOR_SOURCE[row.source];
  try {
    const token = await TokenService.accessTokenFor(
      organizationId,
      userId,
      provider,
    );
    if (token.outcome === "not-connected") {
      await SyncStateRepository.settle(organizationId, row.id, {
        status: "FAILED",
        reason: "Not connected.",
      });
      return;
    }
    if (token.outcome === "needs-reconnect") {
      await SyncStateRepository.needReconnect(
        organizationId,
        userId,
        SOURCES_BY_PROVIDER[provider],
        token.reason,
      );
      return;
    }
    if (token.outcome === "failed") {
      await SyncStateRepository.settle(organizationId, row.id, {
        status: "FAILED",
        reason: token.reason,
      });
      return;
    }
    const result = await SYNCERS[row.source]({
      row,
      accessToken: token.accessToken,
      budget,
      capture: {
        organizationId,
        userId,
        mailbox: token.accountEmail,
        autoCreate: row.autoCreate,
        origin: row.source,
      },
      context: once(() => MatchService.context(organizationId)),
    });
    if (result.status === "UNAUTHORIZED") {
      // The access token was refused before it expired: the next check
      // refreshes it, and a refused refresh asks the member to reconnect.
      const connection = await ConnectionRepository.find(
        organizationId,
        userId,
        provider,
      );
      if (connection) {
        await ConnectionRepository.expireAccessToken(
          organizationId,
          connection.id,
        );
      }
      await SyncStateRepository.settle(organizationId, row.id, {
        status: "FAILED",
        reason: result.reason,
        cursor: result.cursor,
      });
      return;
    }
    await SyncStateRepository.settle(organizationId, row.id, result);
  } catch (error) {
    // A failed write's message would quote the tokens it was storing.
    console.error("[mailbox] check failed", {
      organizationId,
      userId,
      source: row.source,
      ...loggableError(error),
    });
    await SyncStateRepository.settle(organizationId, row.id, {
      status: "FAILED",
      // A missing or changed TOKEN_ENCRYPTION_KEY says so (tokenCrypto.ts).
      reason:
        error instanceof UserFacingError
          ? error.message
          : "The check stopped on an unexpected error; the next one retries.",
    }).catch(() => {});
  }
}

/** The sources whose provider's client the gateway holds. */
async function readySources(): Promise<SyncSource[]> {
  const ready = await Promise.all(
    MAILBOX_PROVIDERS.map(async (provider) =>
      (await clientStatus(provider)).ready ? SOURCES_BY_PROVIDER[provider] : [],
    ),
  );
  return ready.flat();
}

/**
 * The minute cron: checks the due mailboxes of every organization, each as
 * its organization's work, within the tick's budget.
 */
async function runDue(): Promise<{ checked: number }> {
  const sources = await readySources();
  if (sources.length === 0) return { checked: 0 };
  const rows = await SyncStateRepository.due({
    now: new Date().toISOString(),
    sources,
    limit: SWEEP.rows,
  });
  if (rows.length === 0) return { checked: 0 };
  const budget: CallBudget = {
    calls: SWEEP.calls,
    deadline: Date.now() + SWEEP.wallMs,
  };
  let checked = 0;
  await runLimited(SWEEP.concurrency, rows, async (due) => {
    if (budget.calls < SWEEP.minCallsToStart || Date.now() >= budget.deadline) {
      return;
    }
    const row = await SyncStateRepository.claim({
      organizationId: due.organizationId,
      id: due.id,
    });
    if (!row) return;
    checked += 1;
    await forOrganization(row.organizationId, () => runClaimed(row, budget));
  });
  if (checked > 0) console.log("[mailbox] sweep", { checked, ...budget });
  return { checked };
}

/** A member's "Check now": runs their sources of `provider` at once. */
async function checkNow(
  organizationId: string,
  userId: string,
  provider: MailboxProvider,
): Promise<void> {
  const rows = await SyncStateRepository.listForUser(organizationId, userId);
  for (const due of rows) {
    if (PROVIDER_FOR_SOURCE[due.source] !== provider) continue;
    const row = await SyncStateRepository.claim({
      organizationId,
      id: due.id,
      force: true,
    });
    if (!row) continue;
    await runClaimed(row, {
      calls: CHECK_NOW.calls,
      deadline: Date.now() + CHECK_NOW.wallMs,
    });
  }
}

export const MailboxSyncService = { runDue, checkNow };
