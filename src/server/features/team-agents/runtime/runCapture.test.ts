import { beforeEach, describe, expect, it, vi } from "vitest";

// A version reads the organization's captured email and meetings only when it
// grants them, only on the records in its scope, never another
// organization's, and nothing a member deleted from their synced data. What
// it reads comes back as an outsider's text, and a run, which nobody
// watches, reads web pages only from its records' own sites and its
// searches' sources, and none at all when its version may read captured mail.
const { database } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return { database: await createSqliteTestDb() };
});
vi.mock("cloudflare:workers", () => ({
  env: {},
  waitUntil: vi.fn(),
}));
vi.mock("@/db", () => ({ db: database.db }));
vi.mock("@/db/runBatch", () => database.runBatchModule);
vi.mock("@/server/features/agent/lib/perplexity", () => ({
  webResearchAccess: async () => fetch,
  asker: () => async () => ({
    ok: true,
    data: {
      text: "Acme raised a Series B.",
      citations: ["https://news.test/acme-series-b?utm_source=feed"],
    },
  }),
}));

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
    tools,
    call,
    read: (kind: "company" | "contact" | "deal", id: string) =>
      call("read_crm_record", { kind, id }),
    inspect: () => call("inspect_run", {}),
  };
}

describe("captured mail in runs", () => {
  beforeEach(async () => {
    await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
    await database.seedTwoOrganizations();
    await database.exec(`
        INSERT INTO company (id, organization_id, name, domain) VALUES ('acme', 'org_a', 'Acme', 'acme.test'), ('globex', 'org_a', 'Globex', 'globex.test');
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
    expect(mail).toContain(
      `<untrusted-data source=\\"email\\">\\n${MAIL_TEXT}`,
    );
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

  it("reads pages only from its records' sites and its searches' sources, and none when it may read captured mail", async () => {
    for (const grant of [EMAIL, CALENDAR]) {
      expect((await run([grant])).tools.web_fetch).toBeUndefined();
    }
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response("Pricing"));
    const agent = await run(
      [{ kind: "company", id: "acme", label: "Acme" }],
      "SELECTED",
    );
    expect(
      await agent.call("web_search", { question: "What's new at Acme?" }),
    ).toContain('<untrusted-data source=\\"web search\\">');
    for (const url of [
      "https://www.acme.test/pricing?ref=secret",
      "https://news.test/acme-series-b?d=secret",
      "https://globex.test/",
    ]) {
      await agent.call("web_fetch", { url });
    }
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      new URL("https://www.acme.test/pricing"),
      new URL("https://news.test/acme-series-b"),
    ]);
  });

  it("can't read a member's synced data once they delete it", async () => {
    await SyncedDataRepository.purgeSynced(ORG, "user_a", "google");
    const agent = await run([EMAIL, CALENDAR]);
    const read = await agent.read("contact", "paula");
    expect(read).not.toContain(MAIL_TEXT);
    expect(read).not.toContain(MEETING_TITLE);
  });
});
