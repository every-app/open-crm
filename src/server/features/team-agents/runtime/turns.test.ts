import type { UIMessage } from "ai";
import { describe, expect, it, vi } from "vitest";

// A builder chat's turn: a message that asks for an agent, in words as much
// as with the command, gets the build tools; a question gets the research
// agent's people and company research instead, and never the build tools.
vi.mock("cloudflare:workers", () => ({ env: {}, waitUntil: vi.fn() }));
vi.mock("@/db", () => ({ db: {}, withPgClient: (fn: () => unknown) => fn() }));

import { FREE } from "@/server/features/agent/runtime/budget";
import type { ChatSession } from "@/server/features/agent/runtime/session";
import { prepareBuilderTurn } from "./turns";

const session: ChatSession = {
  kind: "chat",
  sessionId: "chat.6f72675f61.1",
  organizationId: "org_a",
  record: { contactId: null, companyId: null, dealId: null },
  task: null,
  conversation: { id: "c1", userId: "user_a", title: "Chat", kind: "BUILDER" },
};

function toolsFor(text: string): string[] {
  const message: UIMessage = {
    id: "m1",
    role: "user",
    parts: [{ type: "text", text }],
  };
  const { tools } = prepareBuilderTurn(session, {
    thinkSystem: "",
    messages: [message],
    spend: FREE,
  });
  return Object.keys(tools);
}

describe("a builder chat's turn", () => {
  it("builds an agent asked for in words, and answers a question with research", () => {
    const build = toolsFor("Set up an agent that flags deals gone quiet");
    expect(build).toEqual(
      expect.arrayContaining(["write_agent_file", "save_agent_draft"]),
    );
    expect(build).not.toContain("research_person");

    const question = toolsFor("Who should we talk to at Acme?");
    expect(question).toEqual(
      expect.arrayContaining([
        "research_person",
        "research_company",
        "get_linkedin_profile",
        "get_contact_work_history",
        "find_contact_socials",
        "list_fields",
        "list_deals",
      ]),
    );
    expect(question).not.toContain("save_agent_draft");
  });
});
