import { beforeEach, describe, expect, it, vi } from "vitest";

const { database } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return { database: await createSqliteTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ db: database.db }));
vi.mock("@/db/runBatch", () => database.runBatchModule);

import { ContactService } from "@/server/features/contacts/services/ContactService";
import { contactListSchema } from "@/types/schemas/contacts";
import { createListSchema } from "@/types/schemas/lists";
import { ListService } from "./ListService";

const A = "org_a";
const B = "org_b";

const outreach = (organizationId: string, name = "Backlink outreach") =>
  ListService.createList(
    organizationId,
    "user_a",
    createListSchema.parse({ entity: "CONTACT", name, template: "OUTREACH" }),
  );

const stageId = (
  list: { stages: { id: string; name: string }[] },
  name: string,
) => {
  const stage = list.stages.find((candidate) => candidate.name === name);
  if (!stage) throw new Error(`no stage ${name}`);
  return stage.id;
};

const contactsIn = async (
  organizationId: string,
  filters: Record<string, unknown>,
) =>
  (
    await ContactService.listContacts(
      organizationId,
      contactListSchema.parse({ sort: "name", dir: "asc", ...filters }),
    )
  ).rows.map((row) => row.firstName);

describe("ListService", () => {
  beforeEach(async () => {
    await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
    await database.seedTwoOrganizations();
    await database.exec(`
      INSERT INTO contact (id, organization_id, first_name, last_name, email) VALUES
        ('maya', 'org_a', 'Maya', 'Chen', 'maya@dailypour.test'),
        ('jonas', 'org_a', 'Jonas', 'Weber', 'jonas@brightline.test'),
        ('theo', 'org_b', 'Theo', 'Park', 'theo@kettle.test');
    `);
  });

  it("starts a list from its template and adds each record once", async () => {
    const list = await outreach(A);
    expect(list.stages.map((stage) => [stage.name, stage.kind])).toEqual([
      ["To contact", "OPEN"],
      ["Contacted", "OPEN"],
      ["Replied", "OPEN"],
      ["Done", "DONE"],
      ["Not interested", "DROPPED"],
    ]);

    expect(
      await ListService.addToList(A, "user_a", {
        listId: list.id,
        ids: ["maya", "missing"],
      }),
    ).toEqual({ added: 1, alreadyIn: 0, notFound: 1 });
    expect(
      await ListService.addToList(A, "user_a", {
        listId: list.id,
        ids: ["maya", "jonas"],
      }),
    ).toEqual({ added: 1, alreadyIn: 1, notFound: 0 });

    const after = await ListService.getList(A, list.id);
    expect(after.total).toBe(2);
    // Left out, the stage is the list's first.
    expect(after.stages[0]?.count).toBe(2);
  });

  it("files a stage change on the record's timeline, with its note", async () => {
    const list = await outreach(A);
    await ListService.addToList(A, "user_a", {
      listId: list.id,
      ids: ["maya"],
    });

    expect(
      await ListService.setStage(A, "user_a", {
        listId: list.id,
        ids: ["maya", "jonas"],
        stageId: stageId(list, "Replied"),
        note: "Wants a short pitch.",
      }),
    ).toEqual({ moved: 1, unchanged: 0, notInList: 1 });

    expect(
      await database.rows(
        "SELECT type, body, contact_id, meta FROM activity WHERE organization_id = 'org_a'",
      ),
    ).toMatchObject([
      {
        type: "STAGE_CHANGE",
        body: "Wants a short pitch.",
        contact_id: "maya",
        meta: JSON.stringify({
          list: "Backlink outreach",
          listId: list.id,
          from: "To contact",
          to: "Replied",
        }),
      },
    ]);
    const [maya] = await database.rows(
      "SELECT last_activity_at FROM contact WHERE id = 'maya'",
    );
    expect(maya?.last_activity_at).not.toBeNull();
    const [membership] = await ListService.recordLists(A, "CONTACT", "maya");
    expect(membership?.stage?.name).toBe("Replied");
  });

  it("filters the contacts list by list and stage", async () => {
    const list = await outreach(A);
    await ListService.addToList(A, "user_a", {
      listId: list.id,
      ids: ["maya", "jonas"],
    });
    await ListService.setStage(A, "user_a", {
      listId: list.id,
      ids: ["jonas"],
      stageId: stageId(list, "Contacted"),
    });

    expect(await contactsIn(A, { list: list.id })).toEqual(["Maya", "Jonas"]);
    expect(
      await contactsIn(A, {
        list: list.id,
        listStage: [stageId(list, "Contacted")],
      }),
    ).toEqual(["Jonas"]);
    const { rows } = await ContactService.listContacts(
      A,
      contactListSchema.parse({ list: list.id }),
    );
    expect(rows.find((row) => row.id === "jonas")?.lists).toEqual([
      {
        id: list.id,
        name: "Backlink outreach",
        color: "blue",
        stageId: stageId(list, "Contacted"),
        stage: "Contacted",
        due: false,
      },
    ]);
  });

  it("adds everyone the filters match", async () => {
    const list = await outreach(A);
    expect(
      await ListService.addMatchingToList(A, "user_a", {
        listId: list.id,
        filters: { q: "weber" },
      }),
    ).toEqual({ added: 1, alreadyIn: 0, notFound: 0, matched: 1 });
    expect(await contactsIn(A, { list: list.id })).toEqual(["Jonas"]);
  });

  it("marks entries Due once their record has been quiet for the list's days", async () => {
    const list = await ListService.createList(
      A,
      "user_a",
      createListSchema.parse({
        entity: "CONTACT",
        name: "Networking",
        template: "NETWORKING",
        followUpDays: 30,
      }),
    );
    await ListService.addToList(A, "user_a", {
      listId: list.id,
      ids: ["maya", "jonas"],
    });
    await database.exec(`
      UPDATE list_entry SET added_at = '2026-01-01T00:00:00.000Z';
      UPDATE contact SET last_activity_at = '2026-01-02T00:00:00.000Z' WHERE id = 'maya';
      UPDATE contact SET last_activity_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 'jonas';
    `);

    expect((await ListService.getList(A, list.id)).due).toBe(1);
    expect(await contactsIn(A, { list: list.id, due: true })).toEqual(["Maya"]);
    const { entries } = await ListService.listEntries(A, {
      listId: list.id,
      stage: [],
      due: false,
      limit: 50,
    });
    expect(entries.map((entry) => [entry.name, entry.due])).toEqual(
      expect.arrayContaining([
        ["Maya Chen", true],
        ["Jonas Weber", false],
      ]),
    );
  });

  it("won't remove a stage while anyone is at it", async () => {
    const list = await outreach(A);
    await ListService.addToList(A, "user_a", {
      listId: list.id,
      ids: ["maya"],
    });
    const kept = list.stages
      .slice(1)
      .map(({ id, name, kind }) => ({ id, name, kind }));

    await expect(
      ListService.setStages(A, { listId: list.id, stages: kept }),
    ).rejects.toThrow("1 is at To contact");

    await ListService.removeFromList(A, { listId: list.id, ids: ["maya"] });
    const after = await ListService.setStages(A, {
      listId: list.id,
      stages: [...kept, { name: "Paid placement", kind: "DONE" }],
    });
    expect(after.stages.map((stage) => stage.name)).toEqual([
      "Contacted",
      "Replied",
      "Done",
      "Not interested",
      "Paid placement",
    ]);
  });

  it("deletes a list without touching its records or their timelines", async () => {
    const list = await outreach(A);
    await ListService.addToList(A, "user_a", {
      listId: list.id,
      ids: ["maya"],
    });
    await ListService.setStage(A, "user_a", {
      listId: list.id,
      ids: ["maya"],
      stageId: stageId(list, "Contacted"),
    });

    await ListService.deleteList(A, list.id);

    expect(
      await database.rows("SELECT id FROM contact WHERE id = 'maya'"),
    ).toHaveLength(1);
    expect(
      await database.rows(
        "SELECT list_entry_id FROM activity WHERE contact_id = 'maya'",
      ),
    ).toEqual([expect.objectContaining({ list_entry_id: null })]);
  });

  it("keeps each organization's lists to itself", async () => {
    const list = await outreach(A);
    await ListService.addToList(A, "user_a", {
      listId: list.id,
      ids: ["maya"],
    });

    expect(await ListService.listLists(B, { includeArchived: true })).toEqual(
      [],
    );
    await expect(ListService.getList(B, list.id)).rejects.toThrow(/No list/);
    await expect(
      ListService.addToList(B, "user_b", { listId: list.id, ids: ["theo"] }),
    ).rejects.toThrow(/No list/);
    await expect(
      ListService.setStage(B, "user_b", {
        listId: list.id,
        ids: ["maya"],
        stageId: null,
      }),
    ).rejects.toThrow(/No list/);
    await expect(ListService.deleteList(B, list.id)).rejects.toThrow(/No list/);
    // Org A's list takes none of org B's contacts.
    expect(
      await ListService.addToList(A, "user_a", {
        listId: list.id,
        ids: ["theo"],
      }),
    ).toEqual({ added: 0, alreadyIn: 0, notFound: 1 });
    expect(await ListService.recordLists(B, "CONTACT", "maya")).toEqual([]);
    expect(await contactsIn(B, { list: list.id })).toEqual([]);
  });

  it("refuses a second live list with the same name, in any case", async () => {
    await outreach(A);
    await expect(outreach(A, "BACKLINK OUTREACH")).rejects.toThrow(
      "There is already a list with that name.",
    );
    await expect(outreach(B)).resolves.toMatchObject({
      name: "Backlink outreach",
    });
  });
});
