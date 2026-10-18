import { beforeEach, describe, expect, it, vi } from "vitest";

// A person's builder chats as Chat's column lists them, and the records the
// composer offers to tag, on both backends. A chat starts with its first
// message and files in one call that leaves nothing behind when it fails and
// starts no second chat when retried; a chat is working only while its own
// agent says a turn is answering, whatever its timestamps suggest; the tag
// picker starts from the most recently active records, offers captured email
// and meetings only once someone here has connected them, and never shows
// another organization's.
const { testDb, answering, asked, stored, kept, handed } = await vi.hoisted(
  async () => {
    const { createDualDialectTestDb } =
      await import("@/server/testing/dualDialectTestDb");
    return {
      testDb: await createDualDialectTestDb(),
      answering: new Set<string>(),
      asked: vi.fn<(sessionId: string) => void>(),
      // R2's objects, by key.
      stored: new Map<string, Uint8Array>(),
      kept: vi.fn<(key: string) => void>(),
      // What each chat's agent was handed, by session: its messages' ids.
      handed: vi.fn<(sessionId: string, messageId: string) => void>(),
    };
  },
);
vi.mock("cloudflare:workers", () => ({
  env: {
    get DATABASE_PROVIDER() {
      return testDb.modules.workers.env.DATABASE_PROVIDER;
    },
    R2: {
      put: async (key: string, bytes: Uint8Array) => {
        kept(key);
        stored.set(key, bytes);
      },
      delete: async (keys: string[]) => {
        for (const key of keys) stored.delete(key);
      },
    },
  },
  waitUntil: vi.fn(),
}));
vi.mock("@/db", () => testDb.modules.db);
vi.mock("@/db/runBatch", () => testDb.modules.runBatch);
vi.mock("@/db/schema", () => testDb.modules.schema);
// Each chat's CrmAgent, which the list asks whether a turn is answering and
// a new chat hands its first message.
vi.mock("agents", () => ({
  getAgentByName: async (_namespace: unknown, sessionId: string) => ({
    isAnswering: async () => {
      asked(sessionId);
      return answering.has(sessionId);
    },
    submitMessages: async (messages: { id: string }[]) => {
      for (const message of messages) handed(sessionId, message.id);
    },
  }),
}));

import { SCOPE_FOR_SOURCE } from "@/shared/mailbox";
import { BuilderRepository } from "../repositories/BuilderRepository";
import { BuilderResourceService } from "./BuilderResourceService";
import { BuilderService } from "./BuilderService";
import { BuilderToolService } from "./BuilderToolService";

const owner = { organizationId: "org_a", userId: "user_a", role: "owner" };
const outsider = { organizationId: "org_b", userId: "user_b", role: "owner" };

/** A first message from Chat home, with a tag and a file. */
const firstMessage = () => ({
  chatId: crypto.randomUUID(),
  text: "What do these say about Acme?",
  resources: [{ kind: "company", id: "acme", label: "Acme" }],
  attachments: [
    { name: "shot.png", mediaType: "image/png", contentBase64: btoa("png") },
  ],
});

for (const dialect of ["sqlite", "postgres"] as const) {
  describe(`builder chats (${dialect})`, () => {
    const database = testDb.use(dialect);

    beforeEach(async () => {
      testDb.use(dialect);
      answering.clear();
      stored.clear();
      await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
      await database.seedTwoOrganizations();
    });

    it("starts a chat with its first message and file in one call, and a retry starts no other", async () => {
      const input = firstMessage();
      const chat = await BuilderService.startConversation(owner, input);
      expect(await BuilderService.startConversation(owner, input)).toEqual(
        chat,
      );

      const chats = await BuilderService.listConversations(owner);
      expect(chats.map((row) => row.id)).toEqual([input.chatId]);
      const { attachments } = await BuilderService.getConversation(
        owner,
        input.chatId,
      );
      expect(attachments.map((file) => file.name)).toEqual(["shot.png"]);
      expect(stored.size).toBe(1);
      // Handed both times: the agent takes its first message once.
      expect(handed.mock.calls).toEqual([
        [chat.sessionId, input.chatId],
        [chat.sessionId, input.chatId],
      ]);

      // The same id from another organization starts nothing there and
      // touches nothing here.
      await expect(
        BuilderService.startConversation(outsider, input),
      ).rejects.toThrow();
      expect(await BuilderService.listConversations(outsider)).toEqual([]);
      expect(stored.size).toBe(1);
    });

    it("leaves no chat behind when a file can't be kept or the message can't be handed over", async () => {
      kept.mockImplementationOnce(() => {
        throw new Error("R2 is down");
      });
      await expect(
        BuilderService.startConversation(owner, firstMessage()),
      ).rejects.toThrow("R2 is down");

      handed.mockImplementationOnce(() => {
        throw new Error("The agent is unreachable");
      });
      await expect(
        BuilderService.startConversation(owner, firstMessage()),
      ).rejects.toThrow("The agent is unreachable");

      expect(await BuilderService.listConversations(owner)).toEqual([]);
      expect(stored.size).toBe(0);
    });

    it("shows a chat working only while its agent is answering a turn", async () => {
      const now = new Date().toISOString();
      const earlier = "2026-10-01T09:00:00.000Z";
      // Two turns open by their timestamps, and one that has replied.
      await database.exec(`
        INSERT INTO agent_conversation (id, organization_id, kind, user_id, session_id, message_count, last_message_at, last_assistant_at, last_read_at) VALUES
          ('busy', 'org_a', 'BUILDER', 'user_a', 'chat.busy', 1, '${now}', NULL, '${now}'),
          ('failed', 'org_a', 'BUILDER', 'user_a', 'chat.failed', 1, '${now}', NULL, '${now}'),
          ('done', 'org_a', 'BUILDER', 'user_a', 'chat.done', 2, '${earlier}', '${earlier}', '${now}');
      `);
      answering.add("chat.busy");

      const chats = await BuilderService.listConversations(owner);
      expect(
        Object.fromEntries(chats.map((chat) => [chat.id, chat.state])),
      ).toEqual({ busy: "working", failed: "idle", done: "idle" });
      // A chat whose last turn replied is not woken to ask.
      expect(asked).not.toHaveBeenCalledWith("chat.done");
    });

    it("offers the organization's most recently active records before anything is typed", async () => {
      await database.exec(`
        INSERT INTO company (id, organization_id, name, last_activity_at, archived_at) VALUES
          ('acme', 'org_a', 'Acme', '2026-10-10T09:00:00.000Z', NULL),
          ('bolt', 'org_a', 'Bolt', NULL, NULL),
          ('cobalt', 'org_a', 'Cobalt', '2026-10-15T09:00:00.000Z', NULL),
          ('gone', 'org_a', 'Gone', '2026-10-16T09:00:00.000Z', '2026-10-16T10:00:00.000Z'),
          ('theirs', 'org_b', 'Acme Two', '2026-10-17T09:00:00.000Z', NULL);
      `);
      const records = async (q: string) =>
        (await BuilderResourceService.search(owner, q))
          .filter((resource) => resource.kind !== "integration")
          .map((resource) => resource.label);

      expect(await records("")).toEqual(["Cobalt", "Acme", "Bolt"]);
      expect(await records("ac")).toEqual(["Acme"]);
    });

    it("offers the Slack channels that match what's typed, and hands the builder the one tagged", async () => {
      // Read from Slack just now, so nothing reads it again.
      const synced = new Date().toISOString();
      await database.exec(`
        INSERT INTO slack_connection (id, organization_id, team_id, bot_token, bot_scopes, synced_at) VALUES
          ('ours', 'org_a', 'T1', 'xoxb-a', 'chat:write', '${synced}'),
          ('theirs', 'org_b', 'T2', 'xoxb-b', 'chat:write', '${synced}');
        INSERT INTO slack_channel (id, organization_id, slack_channel_id, name) VALUES
          ('sales', 'org_a', 'C1', 'sales'),
          ('general', 'org_a', 'C2', 'general'),
          ('their-sales', 'org_b', 'C3', 'sales-team');
      `);
      const channels = async (q: string) =>
        (await BuilderResourceService.search(owner, q))
          .filter((resource) => resource.id.startsWith("slack:channel:"))
          .map((resource) => [resource.id, resource.label]);
      expect(await channels("")).toEqual([]);
      expect(await channels("#sal")).toEqual([["slack:channel:C1", "#sales"]]);

      const chat = await BuilderRepository.createConversation({
        organizationId: "org_a",
        userId: "user_a",
        sessionId: "chat.tagged",
      });
      const context = await BuilderToolService.builderContext({
        organizationId: "org_a",
        userId: "user_a",
        conversationId: chat.id,
        tagged: [],
        taggedIntegrations: ["slack:channel:C1", "slack:channel:C3"],
      });
      expect(context.taggedIntegrations).toEqual([
        { kind: "integration", id: "slack:channel:C1", label: "#sales" },
      ]);
    });

    it("offers Email and Calendar only once someone here has connected them", async () => {
      const integrations = async () =>
        (await BuilderResourceService.search(owner, ""))
          .filter((resource) => resource.kind === "integration")
          .map((resource) => resource.label);
      await database.exec(`
        INSERT INTO mailbox_connection (id, organization_id, user_id, provider, account_email, scopes) VALUES
          ('theirs', 'org_b', 'user_b', 'google', 'b@example.com', '${SCOPE_FOR_SOURCE.gmail} ${SCOPE_FOR_SOURCE.calendar}');
      `);
      expect(await integrations()).toEqual([]);

      await database.exec(`
        INSERT INTO mailbox_connection (id, organization_id, user_id, provider, account_email, scopes) VALUES
          ('ours', 'org_a', 'user_a', 'google', 'a@example.com', '${SCOPE_FOR_SOURCE.gmail}');
      `);
      expect(await integrations()).toEqual(["Email"]);
    });
  });
}
