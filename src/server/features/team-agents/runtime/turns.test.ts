import { generateText, type UIMessage } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

// A builder chat's turn: a message that asks for an agent, in words as much
// as with the command, gets the build tools; a question gets the research
// agent's people and company research and the CRM chat's web tools instead,
// and never the build tools.
vi.mock("cloudflare:workers", () => ({ env: {}, waitUntil: vi.fn() }));
vi.mock("@/db", () => ({ db: {}, withPgClient: (fn: () => unknown) => fn() }));

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

function turn(text: string) {
  const message: UIMessage = {
    id: "m1",
    role: "user",
    parts: [{ type: "text", text }],
  };
  return prepareBuilderTurn(session, {
    thinkSystem: "",
    messages: [message],
    spend: FREE,
    sink: () => {},
  });
}

const toolsFor = (text: string) => Object.keys(turn(text).tools);

const requestBody = z.object({ tools: z.array(z.unknown()) });

describe("a builder chat's turn", () => {
  it("builds an agent asked for in words, and answers a question with research", () => {
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
      tools: turn("What's new at Acme?").tools,
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
