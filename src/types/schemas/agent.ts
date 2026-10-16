import { z } from "zod";
import { RECORD_KINDS } from "@/shared/records";

/** A company, contact or deal the agent is asked about. */
const agentRecordSchema = z.object({
  kind: z.enum(RECORD_KINDS),
  id: z.string().trim().min(1).max(128),
});

export const openAgentConversationSchema = z.object({
  record: agentRecordSchema,
  // Reopen this conversation; otherwise the latest one, or a new one.
  conversationId: z.string().trim().min(1).max(128).optional(),
  // Start a new conversation even when one exists.
  fresh: z.boolean().optional(),
});

export type OpenAgentConversationInput = z.infer<
  typeof openAgentConversationSchema
>;

export const agentRecordQuerySchema = z.object({ record: agentRecordSchema });

export const agentEventsQuerySchema = z.object({
  record: agentRecordSchema,
  limit: z.number().int().min(1).max(200).default(50),
});

export const agentConversationIdSchema = z.object({
  conversationId: z.string().trim().min(1).max(128),
});
