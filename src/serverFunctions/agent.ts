import { createServerFn } from "@tanstack/react-start";
import { waitUntil } from "cloudflare:workers";
import { AgentConversationService } from "@/server/features/agent/services/AgentConversationService";
import { EnrichmentQueueService } from "@/server/features/agent/services/EnrichmentQueueService";
import { forgetTranscript } from "@/server/features/agent/transcript";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";
import {
  agentConversationIdSchema,
  agentEventsQuerySchema,
  agentRecordQuerySchema,
  enrichmentQueueSchema,
  openAgentConversationSchema,
} from "@/types/schemas/agent";

// The Agent tab's server side, around the chat itself: open a conversation
// about a record (the client then connects with
// `useAgent({ agent: conversation.agent, name: conversation.sessionId })`),
// list the person's conversations about it, read what the agent did there,
// mark a conversation read, and delete one. Also the organization's queue of
// agent work, for Home.

export const openAgentConversation = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(openAgentConversationSchema)
  .handler(async ({ data, context }) =>
    AgentConversationService.open(context, data),
  );

export const listAgentConversations = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .validator(agentRecordQuerySchema)
  .handler(async ({ data, context }) =>
    AgentConversationService.list(context, data.record),
  );

export const listAgentActivity = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .validator(agentEventsQuerySchema)
  .handler(async ({ data, context }) =>
    AgentConversationService.activity(context, data.record, data.limit),
  );

export const markAgentConversationRead = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(agentConversationIdSchema)
  .handler(async ({ data, context }) =>
    AgentConversationService.markRead(context, data.conversationId),
  );

export const deleteAgentConversation = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(agentConversationIdSchema)
  .handler(async ({ data, context }) => {
    const removed = await AgentConversationService.remove(
      context,
      data.conversationId,
    );
    // The row is the authority: without it the transcript is unreachable, so
    // emptying the Durable Object can follow the response.
    waitUntil(
      forgetTranscript(removed.sessionId).catch((error: unknown) => {
        console.warn("[agent] could not empty a deleted conversation", {
          conversationId: removed.id,
          reason: error instanceof Error ? error.message : String(error),
        });
      }),
    );
    return { id: removed.id };
  });

export const getEnrichmentQueue = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .validator(enrichmentQueueSchema)
  .handler(async ({ data, context }) =>
    EnrichmentQueueService.queue(context.organizationId, data.limit),
  );
