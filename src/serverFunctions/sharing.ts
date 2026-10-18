import { createServerFn } from "@tanstack/react-start";
import { ChatShareService } from "@/server/features/sharing/services/ChatShareService";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";
import { sharedChatSchema } from "@/types/schemas/sharing";
import { builderChatIdSchema } from "@/types/schemas/team-agents";

// A builder chat's read-only link: its owner's view of it in the Share
// dialog, and the chat a link opens for anyone in the workspace.

export const getChatShare = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .validator(builderChatIdSchema)
  .handler(async ({ data, context }) =>
    ChatShareService.status(context, data.conversationId),
  );

export const createChatShare = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(builderChatIdSchema)
  .handler(async ({ data, context }) =>
    ChatShareService.create(context, data.conversationId),
  );

export const revokeChatShare = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(builderChatIdSchema)
  .handler(async ({ data, context }) =>
    ChatShareService.revoke(context, data.conversationId),
  );

export const getSharedChat = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .validator(sharedChatSchema)
  .handler(async ({ data, context }) =>
    ChatShareService.open(context, data.token),
  );
