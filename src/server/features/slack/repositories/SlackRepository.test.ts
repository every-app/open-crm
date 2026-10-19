import { beforeEach, describe, expect, it, vi } from "vitest";
import type { runBatch } from "@/db/runBatch";

// A read of Slack writes its channels a page at a time (SlackSyncService): an
// upsert that keeps what the same read already wrote, then everything it
// didn't see marked unavailable. Conflict clauses, so both backends. Members'
// lists leave out the private channels only the installer's token sees.
const { databases, current } = await vi.hoisted(async () => {
  const { createPgTestDb, createSqliteTestDb } =
    await import("@/server/testing/testDb");
  return {
    databases: {
      sqlite: await createSqliteTestDb(),
      postgres: await createPgTestDb(),
    },
    current: { dialect: "sqlite" as "sqlite" | "postgres" },
  };
});
vi.mock("cloudflare:workers", () => ({
  env: {
    get DATABASE_PROVIDER() {
      return current.dialect === "postgres" ? "postgres" : "d1";
    },
  },
}));
vi.mock("@/db", () => ({
  get db() {
    return databases[current.dialect].db;
  },
}));
vi.mock("@/db/runBatch", () => ({
  runBatch: (build: Parameters<typeof runBatch>[0]) =>
    databases[current.dialect].runBatch(build),
}));

import { SlackRepository } from "./SlackRepository";

const channel = (slackChannelId: string, isMember: boolean) => ({
  slackChannelId,
  name: slackChannelId.toLowerCase(),
  memberCount: null,
  isPrivate: false,
  isMember,
});

const listed = async (organizationId: string, installerPrivate = true) =>
  (
    await SlackRepository.listChannels(organizationId, {
      limit: 10,
      offset: 0,
      installerPrivate,
    })
  ).map((row) => [row.slackChannelId, row.isMember]);

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`a read's channel writes (${dialect})`, () => {
    const database = databases[dialect];

    beforeEach(async () => {
      current.dialect = dialect;
      await database.exec(
        `DELETE FROM slack_channel; DELETE FROM member; DELETE FROM organization; DELETE FROM "user";`,
      );
      await database.seedTwoOrganizations();
      await database.exec(
        `INSERT INTO slack_channel (id, organization_id, slack_channel_id, name, updated_at) VALUES
           ('gone', 'org_a', 'GONE', 'gone', '2000-01-01T00:00:00.000Z'),
           ('theirs', 'org_b', 'THEIRS', 'theirs', '2000-01-01T00:00:00.000Z');`,
      );
    });

    it("keeps the app's own view of a channel over the installer's, and drops what the read didn't see", async () => {
      const startedAt = new Date().toISOString();
      await SlackRepository.saveChannels(
        "org_a",
        [channel("SALES", true)],
        null,
      );
      await SlackRepository.saveChannels(
        "org_a",
        [channel("SALES", false), channel("PRIVATE", false)],
        startedAt,
      );
      await SlackRepository.markUnseenUnavailable("org_a", startedAt);

      expect(await listed("org_a")).toEqual([
        ["SALES", true],
        ["PRIVATE", false],
      ]);
      expect(await listed("org_b")).toEqual([["THEIRS", false]]);
    });

    it("lists a private channel the app isn't in only when asked to", async () => {
      await SlackRepository.saveChannels(
        "org_a",
        [
          { ...channel("INSIDE", true), isPrivate: true },
          { ...channel("OUTSIDE", false), isPrivate: true },
        ],
        null,
      );

      expect(await listed("org_a", false)).toEqual([
        ["INSIDE", true],
        ["GONE", false],
      ]);
      expect(await listed("org_a", true)).toContainEqual(["OUTSIDE", false]);
    });
  });
}
