import { lazy, Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus, RefreshCw } from "lucide-react";
import { EmptyState } from "@/client/components/EmptyState";
import { QueryError } from "@/client/components/QueryState";
import { Spinner } from "@/client/components/Spinner";
import { Button } from "@/client/components/ui/button";
import { agentStatusQueryOptions } from "@/client/features/settings/settingsQueries";
import { getErrorCode } from "@/client/lib/error-messages";
import { DeleteChatAction } from "./ChatNav";
import { builderChatQueryOptions } from "./teamAgentQueries";

// The chat client (the agent socket, Think's chat hook) loads with the page.
const BuilderThread = lazy(() =>
  import("./BuilderThread").then((module) => ({
    default: module.BuilderThread,
  })),
);

/**
 * One private builder chat (the CRM's agent builder chat): the conversation,
 * and in it the agent it is building, file by file, up to the version a
 * person reviews and deploys.
 */
export function BuilderChatPage({
  conversationId,
}: {
  conversationId: string;
}) {
  const chat = useQuery(builderChatQueryOptions(conversationId));
  const status = useQuery(agentStatusQueryOptions());
  // As in a record's chat: only no way to a model at all closes the
  // composer; after a refusal the next message is the next try.
  const canChat = status.data?.model !== "missing";
  const [working, setWorking] = useState(false);

  if (!chat.data) {
    // A chat that doesn't exist, or isn't this person's (the CRM's
    // ChatUnavailable).
    if (getErrorCode(chat.error) === "NOT_FOUND") {
      return (
        <div className="flex h-full items-center justify-center p-8">
          <EmptyState
            variant="plain"
            icon={null}
            title="Chat unavailable"
            action={
              <Button
                variant="outline"
                nativeButton={false}
                render={<Link to="/chat" />}
              >
                Start a new chat
              </Button>
            }
          />
        </div>
      );
    }
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
  const { conversation } = chat.data;
  const title =
    conversation.madeAgent?.name ?? conversation.title ?? "Agent chat";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4 sm:gap-2.5 sm:pr-4 sm:pl-5">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <h1 className="truncate text-sm font-medium">{title}</h1>
          <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
            Private
          </span>
          {working ? (
            <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
              <RefreshCw className="size-3.5 animate-spin text-primary" />
              <span className="sr-only sm:not-sr-only">Working</span>
            </span>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Start a new chat"
          nativeButton={false}
          render={<Link to="/chat" />}
        >
          <Plus />
        </Button>
        <DeleteChatAction
          conversationId={conversation.id}
          title={title}
          trigger="menu"
        />
      </header>
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center">
            <Spinner />
          </div>
        }
      >
        <BuilderThread
          key={conversation.id}
          chat={chat.data}
          canChat={canChat}
          onWorkingChange={setWorking}
        />
      </Suspense>
    </div>
  );
}
