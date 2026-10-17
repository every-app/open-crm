import { expect } from "vitest";
import { budgetSpender } from "../runtime/budget";
import type { AgentToolContext } from "./context";
import { buildAgentTools } from "./registry";

/**
 * The agent's tools as one session sees them (by default a member's chat
 * about org_a's contact `c_a`), a way to call one, and the research budget
 * the session spends.
 */
export function toolSession(overrides: Partial<AgentToolContext> = {}) {
  const budget = { spent: 0, budget: 4, exhausted: false };
  const tools = buildAgentTools({
    organizationId: "org_a",
    sessionId: "chat.x",
    record: { contactId: "c_a", companyId: null, dealId: null },
    task: null,
    conversation: null,
    attended: true,
    role: "member",
    spend: budgetSpender(budget, () => {}),
    ...overrides,
  });
  const call = async (name: string, input: unknown): Promise<unknown> =>
    tools[name]?.execute?.(input, { toolCallId: "call", messages: [] });
  return { tools, call, budget };
}

/** Matches a reason that says `text`. */
export function says(text: string): unknown {
  return expect.stringContaining(text);
}

/** Context.dev's answer for a person it matched. */
export function enriched(person: object): Response {
  return Response.json({ match: { status: "candidate", score: 92, person } });
}

export const PAULA = {
  name: { first: "Paula", last: "Marchetti", full: "Paula Marchetti" },
  email: "pmarchetti@fernhill.test",
  avatar_url: "https://media.brand.dev/pfp/paula.png",
  social_urls: ["https://www.linkedin.com/in/paulamarchetti"],
  current_role: {
    title: "Head of Revenue",
    organization: { name: "Fernhill", domain: "fernhill.test" },
  },
};

/** What get_linkedin_profile is asked about Paula. */
export const LINKEDIN_CLAIM = {
  slug: "paulamarchetti",
  email: "pmarchetti@fernhill.test",
  companyName: "Fernhill",
  companyDomain: "fernhill.test",
  contactId: "c_a",
};
