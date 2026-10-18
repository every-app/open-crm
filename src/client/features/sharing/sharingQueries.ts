import { queryOptions } from "@tanstack/react-query";
import { validateUIMessages } from "ai";
import { getErrorCode } from "@/client/lib/error-messages";
import { getChatShare, getSharedChat } from "@/serverFunctions/sharing";

/** A shared chat whose owner's turn is answering is read again this often. */
const WORKING_POLL_MS = 5_000;

export const sharingKeys = {
  share: (conversationId: string) =>
    ["sharing", "share", conversationId] as const,
  shared: (token: string) => ["sharing", "shared", token] as const,
};

/** Whether the person's own chat has a live link (the Share dialog). */
export const chatShareQueryOptions = (conversationId: string) =>
  queryOptions({
    queryKey: sharingKeys.share(conversationId),
    queryFn: () => getChatShare({ data: { conversationId } }),
  });

/** The chat a link opens, its messages checked back into chat messages. */
async function readSharedChat(token: string) {
  const { messagesJson, ...chat } = await getSharedChat({ data: { token } });
  const messages = await validateUIMessages({
    messages: JSON.parse(messagesJson),
  });
  return { ...chat, messages };
}

export type SharedChat = Awaited<ReturnType<typeof readSharedChat>>;

/** The chat a link opens, to read. A link that opens nothing isn't retried. */
export const sharedChatQueryOptions = (token: string) =>
  queryOptions({
    queryKey: sharingKeys.shared(token),
    queryFn: () => readSharedChat(token),
    refetchInterval: (query) =>
      query.state.data?.working ? WORKING_POLL_MS : false,
    retry: (failures, error) =>
      getErrorCode(error) !== "NOT_FOUND" && failures < 3,
  });
