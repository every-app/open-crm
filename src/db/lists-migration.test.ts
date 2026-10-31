import { readFileSync } from "node:fs";
import { createClient, type Client } from "@libsql/client";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * 0001_lists runs on CRMs that already hold companies, contacts, deals and
 * their timelines. It must keep every row as it was, keep deals on for the
 * organizations that have them, and leave everything intact if it is rolled
 * back or stops halfway.
 */
const read = (file: string) => readFileSync(`drizzle/sqlite/${file}`, "utf8");
const INIT = read("0000_init.sql");
const LISTS = read("0001_lists.sql");

const statements = (sql: string) =>
  sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);

const EXISTING_TABLES = [
  "organization",
  "user",
  "member",
  "company",
  "contact",
  "deal",
  "deal_contact",
  "activity",
  "field_definition",
  "field_option",
  "field_value",
  "saved_view",
];

// Two organizations as they are before the migration: org_a sells (a deal
// with a contact on it, a stage change on its timeline, a custom field), and
// org_b only keeps contacts.
const SEED = `
  INSERT INTO "user" (id, name, email, email_verified) VALUES ('user_a', 'Ana', 'ana@a.test', 1), ('user_b', 'Bo', 'bo@b.test', 1);
  INSERT INTO organization (id, name, slug, created_at) VALUES ('org_a', 'Org A', 'org-a', 0), ('org_b', 'Org B', 'org-b', 0);
  INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES ('m_a', 'org_a', 'user_a', 'owner', 0), ('m_b', 'org_b', 'user_b', 'owner', 0);
  INSERT INTO workspace (organization_id, name) VALUES ('org_a', 'Bramblewood'), ('org_b', 'Pour Over Club');
  INSERT INTO company (id, organization_id, name, domain) VALUES ('daily_pour', 'org_a', 'The Daily Pour', 'dailypour.test'), ('kettle', 'org_b', 'Kettle & Co', 'kettle.test');
  INSERT INTO contact (id, organization_id, first_name, last_name, email, company_id) VALUES
    ('maya', 'org_a', 'Maya', 'Chen', 'maya@dailypour.test', 'daily_pour'),
    ('theo', 'org_b', 'Theo', 'Park', 'theo@kettle.test', 'kettle');
  INSERT INTO deal (id, organization_id, name, company_id, owner_id, stage, amount, currency) VALUES ('sponsorship', 'org_a', 'Sponsored guide', 'daily_pour', 'user_a', 'CONTRACT_SENT', 1200, 'USD');
  INSERT INTO deal_contact (deal_id, contact_id, organization_id, role) VALUES ('sponsorship', 'maya', 'org_a', 'Editor');
  INSERT INTO activity (id, organization_id, type, subject, company_id, deal_id, created_by_id, meta) VALUES
    ('moved', 'org_a', 'STAGE_CHANGE', 'Stage changed', 'daily_pour', 'sponsorship', 'user_a', '{"from":"DEMO_BOOKED","to":"CONTRACT_SENT"}');
  INSERT INTO activity (id, organization_id, type, body, contact_id, created_by_id) VALUES
    ('note', 'org_a', 'NOTE', 'Prefers a short pitch.', 'maya', 'user_a'),
    ('met', 'org_b', 'NOTE', 'Met at the roasters meetup.', 'theo', 'user_b');
  INSERT INTO field_definition (id, organization_id, entity, key, label, type, position) VALUES ('outreach', 'org_a', 'DEAL', 'outreach_stage', 'Outreach stage', 'SELECT', 0);
  INSERT INTO field_option (id, organization_id, field_id, label, position) VALUES ('replied', 'org_a', 'outreach', 'Replied', 0);
  INSERT INTO field_value (id, organization_id, field_id, deal_id, option_id) VALUES ('fv', 'org_a', 'outreach', 'sponsorship', 'replied');
  INSERT INTO saved_view (id, organization_id, entity, name, filters, owner_id) VALUES ('open', 'org_a', 'DEAL', 'Open deals', '{"stage":["CONTRACT_SENT"]}', 'user_a');
`;

async function apply(client: Client, sql: string) {
  for (const statement of statements(sql)) await client.execute(statement);
}

async function snapshot(client: Client) {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const table of EXISTING_TABLES) {
    tables[table] = (
      await client.execute(`SELECT * FROM "${table}" ORDER BY rowid`)
    ).rows.map((row) => ({ ...row }));
  }
  // Workspace without the column the migration adds.
  tables.workspace = (
    await client.execute(
      "SELECT organization_id, name, website, onboarded_at FROM workspace ORDER BY organization_id",
    )
  ).rows.map((row) => ({ ...row }));
  return tables;
}

async function tableNames(client: Client) {
  return (
    await client.execute(
      "SELECT name FROM sqlite_master WHERE type IN ('table', 'index') ORDER BY name",
    )
  ).rows.map((row) => row.name);
}

describe("0001_lists", () => {
  let client: Client;

  beforeEach(async () => {
    client = createClient({ url: "file::memory:" });
    await client.execute("PRAGMA foreign_keys = ON");
    await apply(client, INIT);
    await client.executeMultiple(SEED);
  });

  it("keeps every existing row, and deals on where there are deals", async () => {
    const before = await snapshot(client);

    await apply(client, LISTS);

    // Activity gains a null list_entry_id; nothing else changes.
    const after = await snapshot(client);
    expect({
      ...after,
      activity: after.activity?.map((row) => {
        const { list_entry_id, ...rest } = row;
        expect(list_entry_id).toBeNull();
        return rest;
      }),
    }).toEqual(before);
    expect(
      (
        await client.execute(
          "SELECT organization_id, deals_enabled FROM workspace ORDER BY organization_id",
        )
      ).rows.map((row) => ({ ...row })),
    ).toEqual([
      { organization_id: "org_a", deals_enabled: 1 },
      { organization_id: "org_b", deals_enabled: 0 },
    ]);
  });

  it("lets the code from before it write as it did", async () => {
    await apply(client, LISTS);

    // An activity and a workspace written without the new columns.
    await client.execute(
      "INSERT INTO activity (id, organization_id, type, contact_id) VALUES ('later', 'org_a', 'NOTE', 'maya')",
    );
    await client.execute(
      "INSERT INTO organization (id, name, slug, created_at) VALUES ('org_c', 'Org C', 'org-c', 0)",
    );
    await client.execute(
      "INSERT INTO workspace (organization_id, name) VALUES ('org_c', 'New')",
    );

    expect(
      (
        await client.execute(
          "SELECT deals_enabled FROM workspace WHERE organization_id = 'org_c'",
        )
      ).rows[0]?.deals_enabled,
    ).toBe(0);
  });

  it("keeps a stage change on the timeline when its list entry goes", async () => {
    await apply(client, LISTS);
    await client.executeMultiple(`
      INSERT INTO record_list (id, organization_id, entity, name, color) VALUES ('networking', 'org_a', 'CONTACT', 'Networking', 'green');
      INSERT INTO list_entry (id, organization_id, list_id, contact_id) VALUES ('entry', 'org_a', 'networking', 'maya');
      INSERT INTO activity (id, organization_id, type, contact_id, list_entry_id) VALUES ('stage', 'org_a', 'STAGE_CHANGE', 'maya', 'entry');
    `);

    await client.execute("DELETE FROM record_list WHERE id = 'networking'");

    expect(
      (
        await client.execute(
          "SELECT id, list_entry_id FROM activity WHERE id = 'stage'",
        )
      ).rows.map((row) => ({ ...row })),
    ).toEqual([{ id: "stage", list_entry_id: null }]);
    expect(
      (await client.execute("SELECT count(*) AS n FROM contact")).rows[0]?.n,
    ).toBe(2);
  });

  it("leaves schema and data as they were when rolled back", async () => {
    const before = await snapshot(client);
    const namesBefore = await tableNames(client);

    await client.execute("BEGIN");
    await apply(client, LISTS);
    await client.execute("ROLLBACK");

    expect(await snapshot(client)).toEqual(before);
    expect(await tableNames(client)).toEqual(namesBefore);
  });

  it("leaves the data intact when it stops halfway", async () => {
    const all = statements(LISTS);

    // Every prefix of the migration: what a failure after that statement leaves.
    for (let stop = 1; stop < all.length; stop++) {
      const partial = createClient({ url: "file::memory:" });
      await partial.execute("PRAGMA foreign_keys = ON");
      await apply(partial, INIT);
      await partial.executeMultiple(SEED);
      const before = await snapshot(partial);
      for (const statement of all.slice(0, stop))
        await partial.execute(statement);
      const after = await snapshot(partial);
      expect({
        ...after,
        activity: after.activity?.map((row) => {
          const { list_entry_id: _, ...rest } = row;
          return rest;
        }),
      }).toEqual(before);
    }
  });
});
