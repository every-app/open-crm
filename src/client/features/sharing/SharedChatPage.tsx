import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { messageHasVisibleContent } from "@/client/components/chat/ChatMessage";
import { useStickToBottom } from "@/client/components/chat/useStickToBottom";
import { QueryError } from "@/client/components/QueryState";
import { Spinner } from "@/client/components/Spinner";
import { AgentCodeWorkspace } from "@/client/features/team-agents/AgentCodeWorkspace";
import { ChatUnavailable } from "@/client/features/team-agents/ChatUnavailable";
import {
  AssistantMessage,
  UserMessage,
} from "@/client/features/team-agents/BuilderMessages";
import { getErrorCode } from "@/client/lib/error-messages";
import { type SharedChat, sharedChatQueryOptions } from "./sharingQueries";

/**
 * A builder chat someone shared, to read (the CRM's SharedAgentChat): its
 * messages and the agent files its builder wrote, without the composer,
 * ratings, questions to answer or the draft's review. A link that was
 * revoked or replaced, or is another organization's, opens nothing.
 */
export function SharedChatPage({ token }: { token: string }) {
  const chat = useQuery(sharedChatQueryOptions(token));

  if (getErrorCode(chat.error) === "NOT_FOUND") return <ChatUnavailable />;
  if (!chat.data) {
    return chat.isError ? (
      <div className="p-6">
        <QueryError
          error={chat.error}
          fallback="This chat could not be loaded."
          onRetry={() => void chat.refetch()}
          isRetrying={chat.isFetching}
          variant="page"
        />
      </div>
    ) : (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  return <SharedThread chat={chat.data} token={token} />;
}

function SharedThread({ chat, token }: { chat: SharedChat; token: string }) {
  const { scrollRef, onScroll } = useStickToBottom(
    chat.messages,
    chat.working ? "working" : "ready",
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4 sm:gap-2.5 sm:pr-4 sm:pl-5">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <h1 className="truncate text-sm font-medium">
            {chat.title ?? "Agent chat"}
          </h1>
          <span className="shrink-0 text-xs text-muted-foreground">
            Read-only
          </span>
          {chat.working ? (
            <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
              <RefreshCw className="size-3.5 animate-spin text-primary" />
              <span className="sr-only sm:not-sr-only">Working</span>
            </span>
          ) : null}
        </div>
      </header>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6 sm:px-5 sm:py-9">
          <p className="text-center text-xs text-muted-foreground">
            Shared by {chat.ownerName}
          </p>
          {chat.messages.map((message) =>
            message.role === "user" ? (
              <UserMessage key={message.id} message={message} share={token} />
            ) : messageHasVisibleContent(message) ? (
              <AssistantMessage
                key={message.id}
                message={message}
                streaming={false}
                hidden={undefined}
              />
            ) : null,
          )}
          {chat.files.length > 0 ? (
            <AgentCodeWorkspace files={chat.files} working={chat.working} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
