import { createServerFn } from "@tanstack/react-start";
import { AgentConversationService } from "@/server/features/agent/services/AgentConversationService";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";
import {
  agentConversationIdSchema,
  agentEventsQuerySchema,
  agentRecordQuerySchema,
  openAgentConversationSchema,
} from "@/types/schemas/agent";

// The Agent tab's server side, around the chat itself: open a conversation
// about a record (the client then connects with
// `useAgent({ agent: conversation.agent, name: conversation.sessionId })`),
// list the person's conversations about it, read what the agent did there,
// and mark a conversation read.

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
