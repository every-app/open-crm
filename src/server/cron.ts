import { runScheduledWork } from "@/server/features/agent/scheduled";
import { ArchiveService } from "@/server/features/archive/services/ArchiveService";
import { CurrencyService } from "@/server/features/currency/services/CurrencyService";

// The Worker's one cron trigger fires every minute (cloudflare.config.ts);
// what runs on a tick depends on its time:
//
// - every minute: the research agent's dispatcher;
// - on the hour: the exchange-rate refresh, which takes each organization
//   whose rates are a day old (one query when nobody is due);
// - at 05:00 UTC: the retention purge of records archived longer than their
//   workspace keeps them, as the CRM ran it.
//
// One job failing doesn't stop the others; the tick still reports failure.
const PURGE_HOUR_UTC = 5;

export async function runCron(
  scheduledTime: number,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  const at = new Date(scheduledTime);
  const onTheHour = at.getUTCMinutes() === 0;
  const jobs: Promise<unknown>[] = [runScheduledWork(env, ctx)];
  if (onTheHour) jobs.push(CurrencyService.refreshDueRates());
  if (onTheHour && at.getUTCHours() === PURGE_HOUR_UTC) {
    jobs.push(
      ArchiveService.purgeAllExpiredArchives().then((totals) => {
        console.log("[archive] retention purge", totals);
      }),
    );
  }
  const results = await Promise.allSettled(jobs);
  for (const result of results) {
    if (result.status === "rejected") throw result.reason;
  }
}
