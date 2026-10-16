import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { AgentConversationRepository } from "../repositories/AgentConversationRepository";
import type { ToolGroup } from "./context";

// Naming a new conversation from its first message, ported from the CRM's
// set_chat_title. Only a person's conversation that has no title yet offers it.

const CHAT_TITLE_MAX_LENGTH = 60;

/** The title as stored: one line, no wrapping quotes, at most 60 characters. */
export function normalizeTitle(title: string): string {
  return title
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .slice(0, CHAT_TITLE_MAX_LENGTH)
    .trim();
}

export const conversationTools: ToolGroup = (context): ToolSet => {
  const conversation = context.conversation;
  if (!conversation?.needsTitle) return {};
  return {
    set_chat_title: tool({
      description:
        "Set the concise title for this new conversation. Available only while it has no title.",
      inputSchema: z.object({
        title: z.string().trim().min(1).max(CHAT_TITLE_MAX_LENGTH),
      }),
      execute: async ({ title }) => {
        const normalized = normalizeTitle(title);
        if (!normalized) throw new Error("A chat title cannot be empty.");
        const result = await AgentConversationRepository.setTitleIfEmpty(
          context.organizationId,
          conversation.id,
          normalized,
        );
        if (!result) throw new Error("This conversation is unavailable.");
        return result;
      },
    }),
  };
};
