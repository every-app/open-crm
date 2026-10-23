import { z } from "zod";
import { RECORD_KINDS } from "@/shared/records";

/** A company, contact or deal the agent is asked about. */
const agentRecordSchema = z.object({
  kind: z.enum(RECORD_KINDS),
  id: z.string().trim().min(1).max(128),
});

const openAgentConversationSchema = z.object({
  record: agentRecordSchema,
  // Reopen this conversation; otherwise the latest one, or a new one.
  conversationId: z.string().trim().min(1).max(128).optional(),
  // Start a new conversation even when one exists.
  fresh: z.boolean().optional(),
});

export type OpenAgentConversationInput = z.infer<
  typeof openAgentConversationSchema
>;

/** The enrichment queue's page, and the most "Load more" reaches. */
export const ENRICHMENT_PAGE = 20;
export const ENRICHMENT_PAGE_MAX = 200;

export const enrichmentQueueSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(ENRICHMENT_PAGE_MAX)
    .default(ENRICHMENT_PAGE),
});
