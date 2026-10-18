import { convertToModelMessages, generateText, type UIMessage } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// A builder chat's turn: a message that asks for an agent, in words as much
// as with the command, gets the build tools; a question gets the research
// agent's people and company research and the CRM chat's web tools instead,
// and never the build tools. What the person tagged and attached reaches the
// model as the CRM's builder delivers a submission: the tags' labels on a line
// before their text, and their images and PDFs as files.
const { database } = await vi.hoisted(async () => {
  const { createSqliteTestDb } = await import("@/server/testing/testDb");
  return { database: await createSqliteTestDb() };
});
vi.mock("cloudflare:workers", () => ({
  env: {
    DATABASE_PROVIDER: "d1",
    // A stored file's bytes are its key, so a file part shows what was read.
    R2: {
      get: async (key: string) => ({
        arrayBuffer: async () => new TextEncoder().encode(key).buffer,
      }),
    },
  },
  waitUntil: vi.fn(),
}));
vi.mock("@/db", () => ({
  db: database.db,
  withPgClient: (fn: () => unknown) => fn(),
}));

import { agentConversation, agentConversationAttachment } from "@/db/schema";
import { FREE } from "@/server/features/agent/runtime/budget";
import type { ChatSession } from "@/server/features/agent/runtime/session";
import { openRouterCostUsd } from "@/server/lib/chatAgent";
import { buildAgentModel } from "@/server/lib/openrouter";
import { prepareBuilderTurn } from "./turns";

const session: ChatSession = {
  kind: "chat",
  sessionId: "chat.6f72675f61.1",
  organizationId: "org_a",
  record: { contactId: null, companyId: null, dealId: null },
  task: null,
  conversation: { id: "c1", userId: "user_a", title: "Chat", kind: "BUILDER" },
};

function turn(messages: UIMessage[]) {
  return prepareBuilderTurn(session, {
    thinkSystem: "",
    messages,
    spend: FREE,
    sink: () => {},
  });
}

function said(
  id: string,
  text: string,
  extras: { tags?: string[]; files?: string[] } = {},
): UIMessage {
  return {
    id,
    role: "user",
    parts: [{ type: "text", text }],
    metadata: {
      resources: (extras.tags ?? []).map((label) => ({
        kind: "company",
        id: label,
        label,
      })),
      attachments: (extras.files ?? []).map((file) => ({
        id: file,
        name: file,
        mediaType: "",
      })),
    },
  };
}

const replied = (id: string): UIMessage => ({
  id,
  role: "assistant",
  parts: [{ type: "text", text: "Noted." }],
});

/** The turn's model messages, from those Think assembles from the chat. */
async function modelMessages(transcript: UIMessage[]) {
  return turn(transcript).messages(await convertToModelMessages(transcript));
}

/** Stores files in a chat as uploads do, each named and keyed by its id. */
async function attach(
  conversationId: string,
  files: { id: string; mediaType: string; size?: number }[],
) {
  await database.db.insert(agentConversationAttachment).values(
    files.map((file) => ({
      id: file.id,
      organizationId: "org_a",
      conversationId,
      userId: "user_a",
      name: file.id,
      mediaType: file.mediaType,
      size: file.size ?? 10,
      storageKey: `files/${file.id}`,
    })),
  );
}

const stored = (key: string) => new TextEncoder().encode(key);

const requestBody = z.object({ tools: z.array(z.unknown()) });

describe("a builder chat's turn", () => {
  beforeEach(async () => {
    await database.exec(`DELETE FROM organization; DELETE FROM "user";`);
    await database.seedTwoOrganizations();
    await database.db.insert(agentConversation).values(
      ["c1", "c2"].map((id) => ({
        id,
        organizationId: "org_a",
        kind: "BUILDER" as const,
        userId: "user_a",
        sessionId: `chat.${id}`,
      })),
    );
  });

  it("builds an agent asked for in words, and answers a question with research", () => {
    const toolsFor = (text: string) =>
      Object.keys(turn([said("m1", text)]).tools);
    const build = toolsFor("Set up an agent that flags deals gone quiet");
    expect(build).toEqual(
      expect.arrayContaining(["write_agent_file", "save_agent_draft"]),
    );
    expect(build).not.toContain("research_person");
    expect(build).not.toContain("web_search");

    const question = toolsFor("Who should we talk to at Acme?");
    expect(question).toEqual(
      expect.arrayContaining([
        "research_person",
        "research_company",
        "get_linkedin_profile",
        "get_contact_work_history",
        "find_contact_socials",
        "web_fetch",
        "web_search",
        "list_fields",
        "list_deals",
      ]),
    );
    expect(question).not.toContain("save_agent_draft");
  });

  it("puts the labels a message tagged on a line before its text", async () => {
    const tagged: UIMessage = {
      ...said("m1", "Who should we talk to at Acme?"),
      metadata: {
        resources: [
          { kind: "company", id: "co_1", label: "Acme" },
          { kind: "contact", id: "ct_1", label: "Jane Doe" },
          { kind: "integration", id: "slack", label: "Slack" },
        ],
      },
    };
    const messages = await modelMessages([
      tagged,
      replied("m2"),
      said("m3", "And what's open with them?"),
    ]);
    expect(messages).toEqual([
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Tagged resources: Acme, Jane Doe, Slack\n\nWho should we talk to at Acme?",
          },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "Noted." }] },
      {
        role: "user",
        content: [{ type: "text", text: "And what's open with them?" }],
      },
    ]);
  });

  it("hands the model a message's images and PDFs as files", async () => {
    await attach("c1", [
      { id: "shot.png", mediaType: "image/png" },
      { id: "deck.pdf", mediaType: "application/pdf" },
    ]);
    const [message] = await modelMessages([
      said("m1", "What do these say?", {
        tags: ["Acme"],
        files: ["shot.png", "deck.pdf"],
      }),
    ]);
    expect(message).toEqual({
      role: "user",
      content: [
        { type: "text", text: "Tagged resources: Acme\n\nWhat do these say?" },
        {
          type: "file",
          data: stored("files/shot.png"),
          mediaType: "image/png",
          filename: "shot.png",
        },
        {
          type: "file",
          data: stored("files/deck.pdf"),
          mediaType: "application/pdf",
          filename: "deck.pdf",
        },
      ],
    });
  });

  it("sends files only from the messages Think replays in full, newest first and at most one message's worth, and only this chat's images and PDFs", async () => {
    const MB = 1_000_000;
    await attach("c1", [
      { id: "old.png", mediaType: "image/png" },
      ...[1, 2, 3, 4].map((n) => ({
        id: `earlier-${n}.pdf`,
        mediaType: "application/pdf",
        size: 2 * MB,
      })),
      { id: "shot.png", mediaType: "image/png", size: 1 * MB },
      { id: "deck.pdf", mediaType: "application/pdf", size: 2 * MB },
      { id: "notes.csv", mediaType: "text/csv" },
    ]);
    await attach("c2", [{ id: "elsewhere.png", mediaType: "image/png" }]);
    const messages = await modelMessages([
      said("m1", "Here's the logo", { files: ["old.png"] }),
      replied("m2"),
      said("m3", "The board decks", {
        files: [1, 2, 3, 4].map((n) => `earlier-${n}.pdf`),
      }),
      replied("m4"),
      said("m5", "And these", {
        files: ["shot.png", "deck.pdf", "notes.csv", "elsewhere.png"],
      }),
    ]);
    const files = messages.flatMap((message) =>
      message.role === "user" && Array.isArray(message.content)
        ? [
            message.content.flatMap((part) =>
              part.type === "file" ? [part.filename] : [],
            ),
          ]
        : [],
    );
    expect(files).toEqual([
      [],
      ["earlier-1.pdf", "earlier-2.pdf", "earlier-3.pdf"],
      ["shot.png", "deck.pdf"],
    ]);
  });

  it("searches the web at OpenRouter, inside the model call that bills it, on Parallel's engine", async () => {
    const sent: unknown[][] = [];
    const gateway: typeof fetch = async (_url, init) => {
      const body = requestBody.parse(
        JSON.parse(typeof init?.body === "string" ? init.body : "null"),
      );
      sent.push(body.tools);
      return Response.json({
        id: "gen-1",
        model: "anthropic/claude-test",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Acme raised a Series B." },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 900,
          completion_tokens: 20,
          total_tokens: 920,
          cost: 0.0123,
        },
      });
    };
    const result = await generateText({
      model: buildAgentModel(gateway, "anthropic/claude-test", "max"),
      tools: turn([said("m1", "What's new at Acme?")]).tools,
      prompt: "What's new at Acme?",
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContainEqual({
      type: "openrouter:web_search",
      engine: "parallel",
      max_results: 10,
    });
    expect(openRouterCostUsd(result.providerMetadata)).toBe(0.0123);
  });
});
