import { beforeEach, describe, expect, it, vi } from "vitest";

const { testDb } = await vi.hoisted(async () => {
  const { createDualDialectTestDb } =
    await import("@/server/testing/dualDialectTestDb");
  return { testDb: await createDualDialectTestDb() };
});
vi.mock("cloudflare:workers", () => testDb.modules.workers);
vi.mock("@/db", () => testDb.modules.db);
vi.mock("@/db/schema", () => testDb.modules.schema);

import { db } from "@/db";
import { member, user } from "@/db/schema";
import { SavedViewService } from "./SavedViewService";

const FILTERS = {
  q: "acme",
  owner: ["user_a"],
  archived: false,
  fields: { seats: { op: "range", min: 10 } },
};

const save = (userId: string, name: string, shared = false) =>
  SavedViewService.create("org_a", userId, {
    entity: "COMPANY",
    name,
    shared,
    filters: FILTERS,
  });

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`SavedViewService (${dialect})`, () => {
    const database = testDb.use(dialect);

    beforeEach(async () => {
      testDb.use(dialect);
      await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
      await database.seedTwoOrganizations();
      // A second member of org_a.
      await db
        .insert(user)
        .values({ id: "user_c", name: "Cy", email: "cy@a.test" });
      await db.insert(member).values({
        id: "m_c",
        organizationId: "org_a",
        userId: "user_c",
        role: "member",
        createdAt: new Date(0),
      });
    });

    it("lists a person's own views and the team's shared ones, filters intact", async () => {
      await save("user_a", "Mine");
      await save("user_a", "Team", true);

      expect(
        await SavedViewService.list("org_a", "user_a", "COMPANY"),
      ).toMatchObject([
        { name: "Mine", mine: true, shared: false, filters: FILTERS },
        { name: "Team", mine: true, shared: true, filters: FILTERS },
      ]);
      expect(
        await SavedViewService.list("org_a", "user_c", "COMPANY"),
      ).toMatchObject([{ name: "Team", mine: false }]);
      expect(await SavedViewService.list("org_a", "user_a", "DEAL")).toEqual(
        [],
      );
    });

    it("lets only its owner rename, share or delete a view", async () => {
      const view = await save("user_a", "Team", true);

      await expect(
        SavedViewService.update("org_a", "user_c", {
          id: view.id,
          name: "Ours",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        SavedViewService.remove("org_a", "user_c", view.id),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      expect(
        await SavedViewService.update("org_a", "user_a", {
          id: view.id,
          name: "Renamed",
          shared: false,
        }),
      ).toMatchObject({ name: "Renamed", shared: false, filters: FILTERS });
      await SavedViewService.remove("org_a", "user_a", view.id);
      expect(await SavedViewService.list("org_a", "user_a", "COMPANY")).toEqual(
        [],
      );
    });

    it("refuses a second view of the same name for the same person", async () => {
      await save("user_a", "Hot leads");

      await expect(save("user_a", "Hot leads")).rejects.toMatchObject({
        code: "CONFLICT",
      });
      expect(await save("user_c", "Hot leads")).toMatchObject({
        name: "Hot leads",
      });
    });

    it("keeps each organization's views to itself", async () => {
      const view = await save("user_a", "Team", true);

      expect(await SavedViewService.list("org_b", "user_b", "COMPANY")).toEqual(
        [],
      );
      await expect(
        SavedViewService.remove("org_b", "user_a", view.id),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(
        await SavedViewService.list("org_a", "user_a", "COMPANY"),
      ).toHaveLength(1);
    });
  });
}
