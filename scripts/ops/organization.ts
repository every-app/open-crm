import { literal, type Database } from "./db.ts";

// One organization at a glance, for support: its workspace, members, how
// much it holds and its connections (never their tokens).

/** The organization `selector` names: its id, or a member's email. */
async function findOrganization(db: Database, selector: string) {
  const where = selector.includes("@")
    ? `o.id in (select m.organization_id from member m join "user" u on u.id = m.user_id where lower(u.email) = lower(${literal(selector)}))`
    : `o.id = ${literal(selector)}`;
  const found = await db.query(
    `select o.id, o.name, w.website, w.onboarded_at
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
  const count = (table: string, where = "") =>
    `(select count(*) from ${table} where organization_id = ${id}${where}) as ${table}`;

  const [[counts], members, mailboxes, syncs, tracking] = await Promise.all([
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
      `select site_id, paused, created_at from tracking_site where organization_id = ${id}`,
    ),
  ]);
  return {
    organization,
    members,
    counts,
    connections: {
      mailboxes,
      syncs,
      tracking: tracking[0] ?? null,
    },
  };
}
