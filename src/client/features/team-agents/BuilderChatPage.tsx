import { lazy, Suspense } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { InlineConfirm } from "@/client/components/InlineConfirm";
import { QueryError } from "@/client/components/QueryState";
import { Spinner } from "@/client/components/Spinner";
import { agentStatusQueryOptions } from "@/client/features/settings/settingsQueries";
import { deleteBuilderChat } from "@/serverFunctions/teamAgents";
import { DraftPanel } from "./DraftPanel";
import { builderChatQueryOptions, teamAgentKeys } from "./teamAgentQueries";

// The chat client (the agent socket, Think's chat hook) loads with the page.
const BuilderThread = lazy(() =>
  import("./BuilderThread").then((module) => ({
    default: module.BuilderThread,
  })),
);

/**
 * One private builder chat: the conversation with the agent builder, and
 * beside it the agent it is building, file by file, up to the version a
 * person reviews and deploys.
 */
export function BuilderChatPage({
  conversationId,
}: {
  conversationId: string;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const chat = useQuery(builderChatQueryOptions(conversationId));
  const status = useQuery(agentStatusQueryOptions());
  const canChat = status.data?.openRouter ?? true;

  const remove = useMutation({
    mutationFn: () => deleteBuilderChat({ data: { conversationId } }),
    onSuccess: async () => {
      toast.success("Chat deleted.");
      await queryClient.invalidateQueries({ queryKey: teamAgentKeys.chats() });
      await navigate({ to: "/agents" });
    },
  });

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
  const { conversation } = chat.data;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2 md:px-6">
        <Link
          to="/agents"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden />
          Agents
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">
          {conversation.title ?? "New chat"}
        </h1>
        <InlineConfirm
          label="Delete this chat"
          confirmLabel="Delete"
          pending={remove.isPending}
          onConfirm={() => remove.mutate()}
        />
      </div>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex min-h-0 flex-col">
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
            />
          </Suspense>
        </div>
        <aside className="hidden min-h-0 overflow-y-auto border-l border-border lg:block">
          <DraftPanel chat={chat.data} />
        </aside>
      </div>
    </div>
  );
}
