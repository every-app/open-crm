import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A builder chat's read-only link, on both backends: one live link per chat,
// which only its owner makes, replaces or revokes; an old link stops at once;
// it opens only inside its organization; and only its token's hash is kept.
const { testDb, transcripts } = await vi.hoisted(async () => {
  const { createDualDialectTestDb } =
    await import("@/server/testing/dualDialectTestDb");
  return {
    testDb: await createDualDialectTestDb(),
    transcripts: new Map<string, unknown[]>(),
  };
});
vi.mock("cloudflare:workers", () => ({
  env: {
    get DATABASE_PROVIDER() {
      return testDb.modules.workers.env.DATABASE_PROVIDER;
    },
    R2: { get: async (key: string) => ({ key }) },
  },
}));
vi.mock("@/db", () => testDb.modules.db);
vi.mock("@/db/runBatch", () => testDb.modules.runBatch);
vi.mock("@/db/schema", () => testDb.modules.schema);
// Each chat's CrmAgent, which holds its messages.
vi.mock("agents", () => ({
  getAgentByName: async (_namespace: unknown, sessionId: string) => ({
    getMessages: async () => transcripts.get(sessionId) ?? [],
    isAnswering: async () => false,
  }),
}));

import { ChatShareService } from "./ChatShareService";

const ana = { organizationId: "org_a", userId: "user_a" };
// Ana's teammate (the gateway's signed identity says so), and someone in
// another organization.
const cy = { organizationId: "org_a", userId: "user_c" };
const bo = { organizationId: "org_b", userId: "user_b" };

const TRANSCRIPT = [
  { id: "m1", role: "user", parts: [{ type: "text", text: "Flag them" }] },
];

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`builder chat links (${dialect})`, () => {
    const database = testDb.use(dialect);

    beforeEach(async () => {
      testDb.use(dialect);
      await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
      await database.seedTwoOrganizations();
      await database.exec(`
        INSERT INTO agent_conversation (id, organization_id, kind, user_id, session_id, title) VALUES
          ('chat_a', 'org_a', 'BUILDER', 'user_a', 'chat.a', 'Flag stale deals');
        INSERT INTO agent_conversation_attachment (id, organization_id, conversation_id, user_id, name, media_type, size, storage_key) VALUES
          ('file_a', 'org_a', 'chat_a', 'user_a', 'deals.png', 'image/png', 4, 'builder-attachments/org_a/chat_a/file_a');
      `);
      transcripts.set("chat.a", TRANSCRIPT);
    });

    it("replaces a chat's link: the new one opens it and the old one stops", async () => {
      const first = await ChatShareService.create(ana, "chat_a");
      const second = await ChatShareService.create(ana, "chat_a");

      await expect(
        ChatShareService.open(cy, first.token),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      const opened = await ChatShareService.open(cy, second.token);
      expect(opened).toMatchObject({
        title: "Flag stale deals",
        ownerName: "Ana",
      });
      expect(JSON.parse(opened.messagesJson)).toEqual(TRANSCRIPT);
      expect(await ChatShareService.status(ana, "chat_a")).toEqual({
        shared: true,
      });
    });

    it("stops a revoked link at once, its attachments included", async () => {
      const { token } = await ChatShareService.create(ana, "chat_a");
      expect(
        await ChatShareService.attachment(cy, token, "file_a"),
      ).toMatchObject({ row: { name: "deals.png" } });

      await ChatShareService.revoke(ana, "chat_a");

      await expect(ChatShareService.open(cy, token)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect(await ChatShareService.attachment(cy, token, "file_a")).toBeNull();
      expect(await ChatShareService.status(ana, "chat_a")).toEqual({
        shared: false,
      });
    });

    it("lets only the chat's owner see, make or revoke its link", async () => {
      const { token } = await ChatShareService.create(ana, "chat_a");

      for (const attempt of [
        () => ChatShareService.status(cy, "chat_a"),
        () => ChatShareService.create(cy, "chat_a"),
        () => ChatShareService.revoke(cy, "chat_a"),
      ]) {
        await expect(attempt()).rejects.toMatchObject({ code: "NOT_FOUND" });
      }
      // Ana's link still opens the chat.
      await expect(ChatShareService.open(cy, token)).resolves.toMatchObject({
        title: "Flag stale deals",
      });
    });

    it("refuses a member of another organization", async () => {
      const { token } = await ChatShareService.create(ana, "chat_a");

      await expect(ChatShareService.open(bo, token)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect(await ChatShareService.attachment(bo, token, "file_a")).toBeNull();
      await expect(ChatShareService.revoke(bo, "chat_a")).rejects.toMatchObject(
        { code: "NOT_FOUND" },
      );
      // The same link opens it inside Ana's organization.
      await expect(ChatShareService.open(cy, token)).resolves.toMatchObject({
        title: "Flag stale deals",
      });
    });

    it("stores the token's SHA-256, never the token", async () => {
      const { token } = await ChatShareService.create(ana, "chat_a");

      const rows = await database.rows(
        `SELECT * FROM agent_conversation_share`,
      );
      expect(rows).toEqual([
        expect.objectContaining({
          conversation_id: "chat_a",
          token_hash: createHash("sha256").update(token).digest("hex"),
        }),
      ]);
      expect(JSON.stringify(rows)).not.toContain(token);
    });
  });
}
