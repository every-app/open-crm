import { beforeEach, describe, expect, it, vi } from "vitest";

const { database } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return { database: await createSqliteTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: database.db }));

import { parseSessionName } from "../sessionName";
import { AgentConversationService } from "./AgentConversationService";

const ana = { organizationId: "org_a", userId: "user_a" };
// A second member of org_a.
const cy = { organizationId: "org_a", userId: "user_c" };
const contact = { kind: "contact" as const, id: "c_a" };

describe("AgentConversationService", () => {
  beforeEach(async () => {
    await database.exec(
      `DELETE FROM agent_event; DELETE FROM agent_conversation; DELETE FROM contact; DELETE FROM member; DELETE FROM organization; DELETE FROM "user";`,
    );
    await database.seedTwoOrganizations();
    await database.exec(
      `INSERT INTO "user" (id, name, email, email_verified) VALUES ('user_c', 'Cy', 'cy@a.test', 1);
       INSERT INTO contact (id, organization_id, first_name) VALUES ('c_a', 'org_a', 'Paula'), ('c_b', 'org_b', 'Bo');`,
    );
  });

  it("opens the person's latest conversation about a record, or a new one", async () => {
    const first = await AgentConversationService.open(ana, { record: contact });
    expect(first).toMatchObject({ agent: "crm-agent", unread: false });
    expect(parseSessionName(first.sessionId)).toMatchObject({
      kind: "chat",
      organizationId: "org_a",
    });
    expect(
      (await AgentConversationService.open(ana, { record: contact })).id,
    ).toBe(first.id);
    const fresh = await AgentConversationService.open(ana, {
      record: contact,
      fresh: true,
    });
    expect(fresh.id).not.toBe(first.id);
    expect(await AgentConversationService.list(ana, contact)).toHaveLength(2);
    // Two people asking about the same contact are having two conversations.
    expect(await AgentConversationService.list(cy, contact)).toEqual([]);
  });

  it("refuses a record or a conversation that isn't the caller's", async () => {
    await expect(
      AgentConversationService.open(ana, {
        record: { kind: "contact", id: "c_b" },
      }),
    ).rejects.toThrow("NOT_FOUND");
    const mine = await AgentConversationService.open(ana, { record: contact });
    await expect(
      AgentConversationService.open(cy, {
        record: contact,
        conversationId: mine.id,
      }),
    ).rejects.toThrow("NOT_FOUND");
    await expect(
      AgentConversationService.markRead(cy, mine.id),
    ).rejects.toThrow("NOT_FOUND");
    await expect(
      AgentConversationService.markRead(ana, mine.id),
    ).resolves.toEqual({
      id: mine.id,
    });
  });

  it("shows a record's research to every member, and a conversation only to its owner", async () => {
    const mine = await AgentConversationService.open(ana, { record: contact });
    await database.exec(
      `INSERT INTO agent_event (id, organization_id, session_id, contact_id, conversation_id, type, data, emitted_at) VALUES
         ('research', 'org_a', 'task.x', 'c_a', NULL, 'task.finished', '{"outcome":"Ran."}', '2026-10-16T00:00:00.000Z'),
         ('chat', 'org_a', '${mine.sessionId}', 'c_a', '${mine.id}', 'turn.started', '{}', '2026-10-16T00:01:00.000Z');`,
    );
    const ids = async (who: typeof ana) =>
      (await AgentConversationService.activity(who, contact, 50)).events.map(
        (event) => event.id,
      );
    expect(await ids(ana)).toEqual(["chat", "research"]);
    expect(await ids(cy)).toEqual(["research"]);
  });

  it("deletes a conversation for its owner only, with the steps taken in it", async () => {
    const mine = await AgentConversationService.open(ana, { record: contact });
    await database.exec(
      `INSERT INTO agent_event (id, organization_id, session_id, contact_id, conversation_id, type, data, emitted_at) VALUES
         ('research', 'org_a', 'task.x', 'c_a', NULL, 'task.finished', '{}', '2026-10-16T00:00:00.000Z'),
         ('chat', 'org_a', '${mine.sessionId}', 'c_a', '${mine.id}', 'turn.started', '{}', '2026-10-16T00:01:00.000Z');`,
    );
    for (const other of [cy, { organizationId: "org_b", userId: "user_a" }]) {
      await expect(
        AgentConversationService.remove(other, mine.id),
      ).rejects.toThrow("NOT_FOUND");
    }
    await expect(
      AgentConversationService.remove(ana, mine.id),
    ).resolves.toEqual({ id: mine.id, sessionId: mine.sessionId });
    expect(await AgentConversationService.list(ana, contact)).toEqual([]);
    expect(await database.rows("SELECT id FROM agent_event")).toEqual([
      expect.objectContaining({ id: "research" }),
    ]);
  });
});
