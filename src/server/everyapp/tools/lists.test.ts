import { beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// The list tools end to end below the gateway, and the deals opt-in: a
// minted identity in, the SDK's checks, the services, real SQL.
const { testDb } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return { testDb: await createSqliteTestDb() };
});
vi.mock("cloudflare:workers", () => ({
  env: {},
  waitUntil: vi.fn(),
}));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => testDb.runBatchModule);

import {
  READ_WRITE,
  bo,
  call,
  failure,
  idFrom,
  type Caller,
} from "@/server/everyapp/toolTestSupport";

const member: Caller = {
  sub: "user_c",
  email: "cy@a.test",
  orgId: "org_a",
  orgRole: "member",
};

const destructive = { scopes: [...READ_WRITE, "mcp:destructive"] };

const contactNames = z.object({
  total: z.number(),
  contacts: z.array(z.object({ name: z.string() })),
});

async function namesIn(args: Record<string, unknown>) {
  const { contacts } = contactNames.parse(await call("list_contacts", args));
  return contacts.map((contact) => contact.name);
}

beforeAll(() => testDb.seedTwoOrganizations());

describe("list tools", () => {
  it("make a list, add people by email, move them with a note, and see it on the contact and its timeline", async () => {
    const listId = await idFrom("create_list", {
      entity: "CONTACT",
      name: "Backlink outreach",
      template: "OUTREACH",
      followUpDays: 7,
    });
    const jo = await idFrom("create_contact", {
      firstName: "Jo",
      email: "jo@acme.test",
    });

    // Emails resolve in any case; one no contact has is reported back.
    expect(
      await call("add_to_list", {
        listId,
        emails: ["JO@acme.test", "nobody@acme.test"],
      }),
    ).toMatchObject({ added: 1, notFound: 1, unmatched: ["nobody@acme.test"] });
    expect(await call("add_to_list", { listId, ids: [jo] })).toMatchObject({
      added: 0,
      alreadyIn: 1,
    });

    // Stages go by name in any case; the note lands on the timeline.
    expect(
      await call("set_list_stage", {
        listId,
        emails: ["jo@acme.test"],
        stage: "replied",
        note: "Wants a call in May",
      }),
    ).toMatchObject({ moved: 1, unchanged: 0, notInList: 0 });
    expect(await call("get_contact", { id: jo })).toMatchObject({
      lists: [
        { id: listId, name: "Backlink outreach", stage: { name: "Replied" } },
      ],
    });
    expect(
      await call("list_activities", { kind: "contact", id: jo }),
    ).toMatchObject({
      activities: [{ type: "STAGE_CHANGE", body: "Wants a call in May" }],
    });
    expect(
      await failure("set_list_stage", { listId, ids: [jo], stage: "Lunch" }),
    ).toBe(
      'Backlink outreach has no stage "Lunch". Its stages: To contact, Contacted, Replied, Done, Not interested.',
    );

    expect(await call("list_lists")).toMatchObject({
      lists: [
        {
          id: listId,
          entity: "CONTACT",
          total: 1,
          noStage: 0,
          stages: [
            { name: "To contact", count: 0 },
            { name: "Contacted", count: 0 },
            { name: "Replied", count: 1 },
            { name: "Done", kind: "DONE", count: 0 },
            { name: "Not interested", kind: "DROPPED", count: 0 },
          ],
        },
      ],
    });
    expect(
      await call("list_list_entries", { listId, stages: ["Replied"] }),
    ).toMatchObject({
      total: 1,
      entries: [{ recordId: jo, name: "Jo", stage: { name: "Replied" } }],
    });
  });

  it("list_contacts filters by list, stage and Due, and add_to_list takes its filters", async () => {
    const listId = await idFrom("create_list", {
      entity: "CONTACT",
      name: "Networking",
      template: "NETWORKING",
      followUpDays: 30,
    });
    const ada = await idFrom("create_contact", {
      firstName: "Ada",
      email: "ada@lovelace.test",
    });
    await idFrom("create_contact", { firstName: "Sam", title: "Founder" });
    await call("add_to_list", { listId, ids: [ada], stage: "Met" });

    // Everyone list_contacts finds, at no stage.
    expect(
      await call("add_to_list", {
        listId,
        matchingContacts: { titles: ["Founder"] },
        stage: null,
      }),
    ).toMatchObject({ matched: 1, added: 1 });

    expect(await namesIn({ list: listId })).toEqual(
      expect.arrayContaining(["Ada", "Sam"]),
    );
    expect(await namesIn({ list: listId, listStages: ["met"] })).toEqual([
      "Ada",
    ]);
    expect(await namesIn({ list: listId, listStages: ["none"] })).toEqual([
      "Sam",
    ]);
    expect(await call("list_contacts", { query: "ada" })).toMatchObject({
      contacts: [{ lists: [{ id: listId, stage: "Met", due: false }] }],
    });

    // Sam has been quiet past the list's 30 days.
    await testDb.exec(
      `UPDATE contact SET last_activity_at = NULL WHERE first_name = 'Sam';
       UPDATE list_entry SET added_at = '2020-01-01T00:00:00.000Z'
         WHERE contact_id = (SELECT id FROM contact WHERE first_name = 'Sam');`,
    );
    expect(await namesIn({ list: listId, due: true })).toEqual(["Sam"]);
    expect(
      await call("list_list_entries", { listId, due: true }),
    ).toMatchObject({ total: 1, entries: [{ name: "Sam", stage: null }] });

    expect(await failure("list_contacts", { listStages: ["Met"] })).toBe(
      "listStages and due filter within a list: give its id as list.",
    );
    expect(
      await call("remove_from_list", {
        listId,
        emails: ["ada@lovelace.test"],
      }),
    ).toMatchObject({ removed: 1, notInList: 0 });
  });

  it("companies by domain; a list refuses the other kind of record; deleting is for owners and admins", async () => {
    const listId = await idFrom("create_list", {
      entity: "COMPANY",
      name: "Partners",
    });
    const acme = await idFrom("create_company", {
      name: "Acme",
      domain: "acme-partners.test",
    });
    expect(
      await call("add_to_list", {
        listId,
        domains: ["https://www.acme-partners.test"],
      }),
    ).toMatchObject({ added: 1 });
    expect(await call("list_companies", { list: listId })).toMatchObject({
      total: 1,
      companies: [{ id: acme, lists: [{ id: listId, stage: null }] }],
    });
    expect(await call("get_company", { id: acme })).toMatchObject({
      lists: [{ id: listId, name: "Partners", stage: null }],
    });
    expect(
      await failure("add_to_list", { listId, emails: ["jo@acme.test"] }),
    ).toBe("Partners holds companies: name them by id or domain.");
    expect(await failure("add_to_list", { listId, matchingContacts: {} })).toBe(
      "Partners holds companies: give matchingCompanies only.",
    );
    expect(await failure("list_contacts", { list: listId })).toBe(
      "Partners holds companies, not contacts.",
    );

    expect(await failure("delete_list", { id: listId })).toContain(
      "mcp:destructive",
    );
    expect(
      await failure(
        "delete_list",
        { id: listId },
        { ...destructive, as: member },
      ),
    ).toBe("Only an owner or an admin can do that.");
    await call("delete_list", { id: listId }, destructive);
    expect(await call("get_company", { id: acme })).toMatchObject({
      lists: [],
    });
  });

  it("another organization can't see, fill or filter by a list, nor reach its records by email", async () => {
    const listId = await idFrom("create_list", {
      entity: "CONTACT",
      name: "Private",
    });
    await idFrom("create_contact", {
      firstName: "Lin",
      email: "lin@secret.test",
    });
    await call("add_to_list", { listId, emails: ["lin@secret.test"] });

    expect(await call("list_lists", {}, { as: bo })).toEqual({ lists: [] });
    const missing = `No list with id ${listId}.`;
    expect(await failure("list_list_entries", { listId }, { as: bo })).toBe(
      missing,
    );
    expect(
      await failure(
        "add_to_list",
        { listId, emails: ["lin@secret.test"] },
        { as: bo },
      ),
    ).toBe(missing);
    expect(await failure("list_contacts", { list: listId }, { as: bo })).toBe(
      missing,
    );

    // Bo's own list: ana's contact's email is no record of his.
    const bos = await idFrom(
      "create_list",
      { entity: "CONTACT", name: "Private" },
      { as: bo },
    );
    expect(
      await call(
        "add_to_list",
        { listId: bos, emails: ["lin@secret.test"] },
        { as: bo },
      ),
    ).toMatchObject({ added: 0, notFound: 1, unmatched: ["lin@secret.test"] });
  });
});

describe("deals opt-in", () => {
  it("deal tools refuse while deals are off; owners and admins turn them on", async () => {
    expect(await call("get_workspace")).toMatchObject({ dealsEnabled: false });
    const off =
      "Deals are turned off for this workspace. An owner or admin turns them on in Settings → General.";
    expect(await failure("list_deals")).toBe(off);
    expect(await failure("get_sales_summary")).toBe(off);
    expect(
      await failure("bulk_set_deal_stage", { ids: ["x"], stage: "CLOSED_WON" }),
    ).toBe(off);

    expect(
      await failure("set_deals_enabled", { enabled: true }, { as: member }),
    ).toBe("Only an owner or an admin can do that.");
    expect(await call("set_deals_enabled", { enabled: true })).toMatchObject({
      dealsEnabled: true,
    });
    expect(await call("list_deals")).toMatchObject({ total: 0 });
    // Another organization's switch is its own.
    expect(await failure("list_deals", {}, { as: bo })).toBe(off);
  });
});
