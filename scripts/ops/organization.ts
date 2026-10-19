import { MAX_ATTEMPTS, RETIRED_OUTCOME } from "../../src/shared/agent-tasks.ts";
import { int, literal, type Database } from "./db.ts";

// One organization at a glance, for support: its workspace, members, how
// much it holds, its connections (never their tokens) and its agent's queue.

const DAY_MS = 24 * 60 * 60 * 1000;

/** The organization `selector` names: its id, or a member's email. */
async function findOrganization(db: Database, selector: string) {
  const where = selector.includes("@")
    ? `o.id in (select m.organization_id from member m join "user" u on u.id = m.user_id where lower(u.email) = lower(${literal(selector)}))`
    : `o.id = ${literal(selector)}`;
  const found = await db.query(
    `select o.id, o.name, w.website, w.onboarded_at, w.model_refused_at, w.model_answered_at, w.enrichment_swept_at
     from organization o left join workspace w on w.organization_id = o.id
     where ${where} order by o.id`,
  );
  if (found.length === 0)
    throw new Error(`No organization matches ${selector}.`);
  if (found.length > 1) {
    const ids = found.map((row) => String(row.id)).join(", ");
    throw new Error(`${selector} is in ${ids}. Name one by its id.`);
  }
  return found[0];
}

export async function lookupOrganization(db: Database, selector: string) {
  const organization = await findOrganization(db, selector);
  const id = literal(String(organization.id));
  const now = literal(new Date().toISOString());
  const dayAgo = literal(new Date(Date.now() - DAY_MS).toISOString());
  const count = (table: string, where = "") =>
    `${int(`(select count(*) from ${table} where organization_id = ${id}${where})`)} as ${table}`;

  const [
    [counts],
    members,
    mailboxes,
    syncs,
    slack,
    tracking,
    tasks,
    retired,
    runs,
  ] = await Promise.all([
    db.query(
      `select ${[
        count("company", " and archived_at is null"),
        count("contact", " and archived_at is null"),
        count("deal", " and archived_at is null"),
        count("activity"),
        count("email_thread"),
        count("calendar_event"),
        count("form_submission"),
        count("tracked_event"),
        count("agent_conversation"),
        count("agent_definition", " and deleted_at is null"),
        count("agent_run"),
      ].join(", ")}`,
    ),
    db.query(
      `select u.email, m.role from member m join "user" u on u.id = m.user_id
         where m.organization_id = ${id} order by m.role, u.email`,
    ),
    db.query(
      `select u.email as member, c.provider, c.account_email, c.status
         from mailbox_connection c join "user" u on u.id = c.user_id
         where c.organization_id = ${id} order by u.email, c.provider`,
    ),
    db.query(
      `select u.email as member, s.source, s.status, s.auto_create, s.last_synced_at, s.next_sync_at, s.last_error
         from mailbox_sync s join "user" u on u.id = s.user_id
         where s.organization_id = ${id} order by u.email, s.source`,
    ),
    db.query(
      `select team_name, team_id, connected_at, synced_at, sync_error
         from slack_connection where organization_id = ${id}`,
    ),
    db.query(
      `select site_id, paused, created_at from tracking_site where organization_id = ${id}`,
    ),
    db.query(
      `select kind, ${int("count(*)")} as open,
           ${int(`sum(case when leased_until > ${now} then 1 else 0 end)`)} as running,
           ${int(`sum(case when attempts >= ${MAX_ATTEMPTS} then 1 else 0 end)`)} as out_of_attempts,
           min(due_at) as oldest_due_at
         from agent_task where organization_id = ${id} and finished_at is null
         group by kind order by kind`,
    ),
    db.query(
      `select kind, ${int("count(*)")} as retired from agent_task
         where organization_id = ${id} and outcome = ${literal(RETIRED_OUTCOME)} and finished_at >= ${dayAgo}
         group by kind order by kind`,
    ),
    db.query(
      `select status, ${int("count(*)")} as runs from agent_run
         where organization_id = ${id} group by status order by status`,
    ),
  ]);
  return {
    organization,
    members,
    counts,
    connections: {
      mailboxes,
      syncs,
      slack: slack[0] ?? null,
      tracking: tracking[0] ?? null,
    },
    queue: { tasks, retiredLastDay: retired, runs },
  };
}
