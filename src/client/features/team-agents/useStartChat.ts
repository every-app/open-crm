import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { startBuilderChat } from "@/serverFunctions/teamAgents";
import { attachmentContent, type ComposerMessage } from "./BuilderComposer";
import { teamAgentKeys } from "./teamAgentQueries";

/**
 * Starts a chat with its first message and that message's files in one call
 * (BuilderService.startConversation), then opens it. The chat's id is chosen
 * once per message, so trying again after a failure finds the chat the first
 * try started instead of making another.
 */
export function useStartChat() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const chatId = useRef<string | null>(null);
  return useMutation({
    mutationFn: async ({ text, resources, files }: ComposerMessage) => {
      chatId.current ??= crypto.randomUUID();
      return startBuilderChat({
        data: {
          chatId: chatId.current,
          text,
          resources,
          attachments: await Promise.all(files.map(attachmentContent)),
        },
      });
    },
    onSuccess: async (chat) => {
      chatId.current = null;
      await queryClient.invalidateQueries({ queryKey: teamAgentKeys.chats() });
      await navigate({ to: "/chat/$chatId", params: { chatId: chat.id } });
    },
  });
}
