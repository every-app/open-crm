import { MAX_ATTEMPTS, RETIRED_OUTCOME } from "../../src/shared/agent-tasks.ts";
import { int, literal, type Database } from "./db.ts";

// The minute cron across the whole deployment, where /health/dispatch shows
// one organization: when each lane last ran (a lane quiet for five minutes
// has stalled), the organizations with the most work waiting (overdue: due
// five minutes ago and not taken), what the dispatcher gave up on in the
// last day, team agent runs, and mailbox checks. An organization's work may
// wait on purpose, so its model refusal is shown beside it.

const MINUTE_MS = 60_000;
const STALE_MS = 5 * MINUTE_MS;
const DAY_MS = 24 * 60 * MINUTE_MS;
const LANES = ["visible", "research", "runs", "sweep"];
/** The lanes /health/dispatch calls stalled; the sweep runs when it's due. */
const WATCHED = new Set(["visible", "research", "runs"]);

export async function dispatchHealth(db: Database) {
  const at = Date.now();
  const now = literal(new Date(at).toISOString());
  const overdueBefore = literal(new Date(at - STALE_MS).toISOString());
  const dayAgo = literal(new Date(at - DAY_MS).toISOString());

  const [ran, organizations, retired, runs, [mailboxChecks]] =
    await Promise.all([
      db.query(
        "select lane, ran_at, failed_at from dispatcher_lane order by lane",
      ),
      db.query(
        `select t.organization_id, ${int("count(*)")} as due,
           ${int(`sum(case when t.due_at <= ${overdueBefore} and (t.leased_until is null or t.leased_until <= ${now}) then 1 else 0 end)`)} as overdue,
           min(t.due_at) as oldest_due_at, w.model_refused_at, w.model_answered_at
         from agent_task t left join workspace w on w.organization_id = t.organization_id
         where t.finished_at is null and t.due_at <= ${now} and t.attempts < ${MAX_ATTEMPTS}
         group by t.organization_id, w.model_refused_at, w.model_answered_at
         order by overdue desc, due desc, t.organization_id limit 20`,
      ),
      db.query(
        `select kind, ${int("count(*)")} as retired from agent_task
         where outcome = ${literal(RETIRED_OUTCOME)} and finished_at >= ${dayAgo}
         group by kind order by kind`,
      ),
      db.query(
        `select status, ${int("count(*)")} as runs from agent_run
         where status in ('QUEUED', 'RUNNING') or (status = 'FAILED' and finished_at >= ${dayAgo})
         group by status order by status`,
      ),
      db.query(
        `select ${int("count(*)")} as due,
           ${int(`coalesce(sum(case when next_sync_at <= ${overdueBefore} then 1 else 0 end), 0)`)} as overdue,
           min(next_sync_at) as oldest_due_at
         from mailbox_sync where next_sync_at <= ${now} and (lease_until is null or lease_until <= ${now})`,
      ),
    ]);
  const lanes = LANES.map((lane) => {
    const row = ran.find((candidate) => candidate.lane === lane);
    const ranAt = typeof row?.ran_at === "string" ? row.ran_at : null;
    const quiet = ranAt === null || at - Date.parse(ranAt) > STALE_MS;
    return {
      lane,
      ranAt,
      failedAt: row?.failed_at ?? null,
      stalled: WATCHED.has(lane) && quiet,
    };
  });
  return {
    ok: lanes.every((lane) => !lane.stalled),
    lanes,
    organizations,
    retiredLastDay: retired,
    runs,
    mailboxChecks,
  };
}
