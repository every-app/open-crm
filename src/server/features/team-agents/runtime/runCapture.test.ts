import { beforeEach, describe, expect, it, vi } from "vitest";

// A version reads the organization's captured email and meetings only when it
// grants them, only on the records in its scope, never another
// organization's, and nothing a member deleted from their synced data.
const { testDb } = await vi.hoisted(async () => {
  const { createDualDialectTestDb } =
    await import("@/server/testing/dualDialectTestDb");
  return { testDb: await createDualDialectTestDb() };
});
vi.mock("cloudflare:workers", () => ({
  env: testDb.modules.workers.env,
  waitUntil: vi.fn(),
}));
vi.mock("@/db", () => testDb.modules.db);
vi.mock("@/db/runBatch", () => testDb.modules.runBatch);
vi.mock("@/db/schema", () => testDb.modules.schema);

import { FREE } from "@/server/features/agent/runtime/budget";
import { SyncedDataRepository } from "@/server/features/mailbox/repositories/SyncedDataRepository";
import {
  CAPTURE_GRANTS,
  type AgentManifest,
  type ManifestResource,
} from "@/shared/team-agents";
import { runnerTools } from "./runnerTools";
import { manifest, ORG, runningRun } from "./runTestSupport";

const EMAIL = CAPTURE_GRANTS.email.resource;
const CALENDAR = CAPTURE_GRANTS.calendar.resource;
const MAIL_TEXT = "We would like to renew at 40 seats";
const MEETING_TITLE = "Renewal call with Paula";
const OTHER_ORG_TEXT = "Org B pricing";

/** A version with `resources` in its scope, and one running run of it. */
async function run(
  resources: ManifestResource[],
  mode: "WORKSPACE" | "SELECTED" = "WORKSPACE",
) {
  const value: AgentManifest = manifest({
    dataScope: { mode, summary: "Scope", resources },
  });
  const runId = await runningRun(value);
  const tools = runnerTools({
    organizationId: ORG,
    sessionId: "s",
    runId,
    manifest: value,
    spend: FREE,
  });
  const call = async (name: string, input: unknown) => {
    const execute = tools[name]?.execute;
    if (!execute) throw new Error(`No ${name} tool`);
    return JSON.stringify(
      await execute(input, { toolCallId: "call", messages: [] }),
    );
  };
  return {
    read: (kind: "company" | "contact" | "deal", id: string) =>
      call("read_crm_record", { kind, id }),
    inspect: () => call("inspect_run", {}),
  };
}

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`captured mail in runs (${dialect})`, () => {
    const database = testDb.use(dialect);

    beforeEach(async () => {
      testDb.use(dialect);
      await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
      await database.seedTwoOrganizations();
      await database.exec(`
        INSERT INTO company (id, organization_id, name) VALUES ('acme', 'org_a', 'Acme'), ('globex', 'org_a', 'Globex');
        INSERT INTO contact (id, organization_id, first_name, email, company_id) VALUES ('paula', 'org_a', 'Paula', 'paula@acme.test', 'acme');
        INSERT INTO deal (id, organization_id, name, company_id, owner_id) VALUES ('renewal', 'org_a', 'Renewal', 'acme', 'user_a');
        INSERT INTO email_thread (id, organization_id, root_message_id, subject, company_id, contact_id, first_message_at, last_message_at, message_count)
          VALUES ('t_a', 'org_a', 'root-a', 'Renewal', 'acme', 'paula', '2026-10-01T10:00:00.000Z', '2026-10-01T10:00:00.000Z', 1),
                 ('t_b', 'org_b', 'root-b', 'Pricing', 'acme', NULL, '2026-10-02T10:00:00.000Z', '2026-10-02T10:00:00.000Z', 1);
        INSERT INTO email_message (id, organization_id, thread_id, rfc_message_id, synced_by_user_id, direction, from_email, recipients, body, sent_at, gmail_message_id)
          VALUES ('m_a', 'org_a', 't_a', 'rfc-a', 'user_a', 'INBOUND', 'paula@acme.test', '[]', '${MAIL_TEXT}', '2026-10-01T10:00:00.000Z', 'g_a'),
                 ('m_b', 'org_b', 't_b', 'rfc-b', 'user_b', 'INBOUND', 'x@acme.test', '[]', '${OTHER_ORG_TEXT}', '2026-10-02T10:00:00.000Z', 'g_b');
        INSERT INTO calendar_event (id, organization_id, ical_uid, original_start_time, title, starts_at, ends_at, status, company_id, contact_id, synced_by_user_id)
          VALUES ('e_a', 'org_a', 'ical-a', '2026-10-03T15:00:00.000Z', '${MEETING_TITLE}', '2026-10-03T15:00:00.000Z', '2026-10-03T15:30:00.000Z', 'confirmed', 'acme', 'paula', 'user_a');
      `);
    });

    it("reads no captured mail or meetings without the grant", async () => {
      const agent = await run([]);
      for (const read of [
        await agent.read("contact", "paula"),
        await agent.read("company", "acme"),
        await agent.read("deal", "renewal"),
      ]) {
        expect(read).toContain('"found":true');
        expect(read).not.toContain(MAIL_TEXT);
        expect(read).not.toContain(MEETING_TITLE);
      }
      expect(await agent.inspect()).toContain(
        '"capturedSources":{"email":false,"calendar":false}',
      );
    });

    it("reads only the sources the version grants", async () => {
      const email = await run([EMAIL]);
      const mail = await email.read("contact", "paula");
      expect(mail).toContain(MAIL_TEXT);
      expect(mail).not.toContain(MEETING_TITLE);

      const calendar = await run([CALENDAR]);
      const meetings = await calendar.read("company", "acme");
      expect(meetings).toContain(MEETING_TITLE);
      expect(meetings).not.toContain(MAIL_TEXT);
    });

    it("reads captured mail only on records in scope, and only its own organization's", async () => {
      const agent = await run(
        [{ kind: "company", id: "acme", label: "Acme" }, EMAIL, CALENDAR],
        "SELECTED",
      );
      const account = await agent.read("company", "acme");
      expect(account).toContain(MAIL_TEXT);
      expect(account).toContain(MEETING_TITLE);
      expect(account).not.toContain(OTHER_ORG_TEXT);
      await expect(agent.read("contact", "paula")).rejects.toThrow(
        "outside this agent version's approved scope",
      );
      await expect(agent.read("company", "globex")).rejects.toThrow(
        "outside this agent version's approved scope",
      );
    });

    it("can't read a member's synced data once they delete it", async () => {
      await SyncedDataRepository.purgeSynced(ORG, "user_a", "google");
      const agent = await run([EMAIL, CALENDAR]);
      const read = await agent.read("contact", "paula");
      expect(read).not.toContain(MAIL_TEXT);
      expect(read).not.toContain(MEETING_TITLE);
    });
  });
}
