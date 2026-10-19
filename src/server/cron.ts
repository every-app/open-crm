import { refreshStatistics } from "@/db/maintenance";
import { runScheduledWork } from "@/server/features/agent/scheduled";
import { AgentRetentionService } from "@/server/features/agent/services/AgentRetentionService";
import { ArchiveService } from "@/server/features/archive/services/ArchiveService";
import { CurrencyService } from "@/server/features/currency/services/CurrencyService";
import { TrackingRetentionService } from "@/server/features/tracking/services/TrackingRetentionService";
import { MailboxSyncService } from "@/server/features/mailbox/services/MailboxSyncService";

// The Worker's one cron trigger fires every minute (cloudflare.config.ts);
// what runs on a tick depends on its time:
//
// - every minute: the research agent's dispatcher, and the mailboxes due a
//   check (each every five minutes; one indexed query when none is due);
// - on the hour: the exchange-rate refresh, which fetches the rates the
//   feed has published since the last fetch and takes each organization
//   whose rates are a day old;
// - at 04:00 UTC: the research agent's cleanup of finished tasks and agent
//   events older than 30 days;
// - at 05:00 UTC: the retention purge of records archived longer than their
//   workspace keeps them, as the CRM ran it, and D1's query statistics
//   (src/db/maintenance.ts);
// - at minute 30 of every hour: website tracking's retention (roll up and
//   delete events past the window, bounded per run, and expired counters).
//
// One job failing doesn't stop the others; the tick still reports failure.
const AGENT_RETENTION_HOUR_UTC = 4;
const PURGE_HOUR_UTC = 5;
const TRACKING_RETENTION_MINUTE = 30;

export async function runCron(
  scheduledTime: number,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  const at = new Date(scheduledTime);
  const onTheHour = at.getUTCMinutes() === 0;
  const jobs: Promise<unknown>[] = [
    runScheduledWork(env, ctx),
    MailboxSyncService.runDue(),
  ];
  if (onTheHour) jobs.push(CurrencyService.refreshDueRates());
  if (onTheHour && at.getUTCHours() === AGENT_RETENTION_HOUR_UTC) {
    jobs.push(AgentRetentionService.purge(at));
  }
  if (onTheHour && at.getUTCHours() === PURGE_HOUR_UTC) {
    jobs.push(
      ArchiveService.purgeAllExpiredArchives().then((totals) => {
        console.log("[archive] retention purge", totals);
      }),
      refreshStatistics(),
    );
  }
  if (at.getUTCMinutes() === TRACKING_RETENTION_MINUTE) {
    jobs.push(TrackingRetentionService.sweep(at));
  }
  const results = await Promise.allSettled(jobs);
  for (const result of results) {
    if (result.status === "rejected") throw result.reason;
  }
}
