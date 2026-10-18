import { lazy, Suspense, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Plus } from "lucide-react";
import { toast } from "sonner";
import { InlineConfirm } from "@/client/components/InlineConfirm";
import { QueryError } from "@/client/components/QueryState";
import { Spinner } from "@/client/components/Spinner";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { LocalDateTime } from "@/client/features/records/LocalDateTime";
import {
  useAppSearch,
  useSetAppSearch,
} from "@/client/features/records/recordStack";
import { agentStatusQueryOptions } from "@/client/features/settings/settingsQueries";
import type { RecordRef } from "@/shared/records";
import {
  deleteAgentConversation,
  openAgentConversation,
} from "@/serverFunctions/agent";
import { AgentComposer } from "./AgentComposer";
import { AgentIdle, AgentUnavailable, ThreadFrame } from "./AgentThreadParts";
import { AgentWork } from "./AgentWork";
import { RECORD_COPY } from "./agentCopy";
import { agentConversationsQueryOptions, agentKeys } from "./agentQueries";

// The chat client (the agent socket, Think's chat hook, Markdown) loads when
// a conversation opens, not with every list a record sheet opens over.
const ConversationThread = lazy(() =>
  import("./ConversationThread").then((module) => ({
    default: module.ConversationThread,
  })),
);

type Conversation = Awaited<ReturnType<typeof openAgentConversation>>;

/**
 * A record's Agent tab: what the agent is doing and did on the record, and
 * the person's conversations with it about the record (the CRM's AgentPanel).
 */
export function RecordAgentPanel({ record }: { record: RecordRef }) {
  const conversations = useQuery(agentConversationsQueryOptions(record));
  // Nothing mounts until the list has loaded: it decides which conversation
  // the tab opens on.
  if (!conversations.data) {
    return conversations.isError ? (
      <div className="p-5">
        <QueryError
          error={conversations.error}
          fallback="Conversations could not be loaded."
          onRetry={() => void conversations.refetch()}
          isRetrying={conversations.isFetching}
        />
      </div>
    ) : (
      <PanelLoading />
    );
  }
  return (
    <LoadedAgentPanel record={record} conversations={conversations.data} />
  );
}

function PanelLoading() {
  return (
    <div className="flex flex-1 items-center justify-center p-10">
      <Spinner />
    </div>
  );
}

/** The URL's `thread` for a new conversation, not started yet. */
const NEW_THREAD = "new";

function LoadedAgentPanel({
  record,
  conversations,
}: {
  record: RecordRef;
  conversations: Conversation[];
}) {
  const queryClient = useQueryClient();
  const setSearch = useSetAppSearch();
  // The open conversation is the URL's (`thread`), so a reload or a link
  // opens it again, as the CRM's record stack kept it. Without one, the tab
  // opens on the conversation it landed on, captured once so a list refetch
  // (a new title, a reply elsewhere) never swaps it out from under a live
  // answer.
  const { thread } = useAppSearch();
  const [landedOn] = useState(() => conversations[0]?.id ?? NEW_THREAD);
  const openId = thread ?? landedOn;
  const setOpenId = (id: string | null) =>
    setSearch({ thread: id ?? NEW_THREAD });
  const [firstMessage, setFirstMessage] = useState<{
    conversationId: string;
    text: string;
  } | null>(null);
  const current = conversations.find((row) => row.id === openId) ?? null;

  // With no way to reach a model the agent can't answer. After the gateway
  // refused it, the notice shows but the composer stays: a message is the
  // next try, so a key set since is picked up at once, and a turn that still
  // can't run says so itself. So does one sent while the check runs.
  const status = useQuery(agentStatusQueryOptions());
  const canChat = status.data?.model !== "missing";
  const refused = status.data?.model === "refused";

  // A conversation exists once there is something to say in it.
  const start = useMutation({
    mutationFn: (_text: string) =>
      openAgentConversation({ data: { record, fresh: true } }),
    onSuccess: (conversation, text) => {
      queryClient.setQueryData(
        agentKeys.conversations(record),
        (rows: Conversation[] | undefined) => [conversation, ...(rows ?? [])],
      );
      setFirstMessage({ conversationId: conversation.id, text });
      setOpenId(conversation.id);
    },
  });

  const remove = useMutation({
    mutationFn: (conversationId: string) =>
      deleteAgentConversation({ data: { conversationId } }),
    onSuccess: async () => {
      setOpenId(null);
      toast.success("Conversation deleted.");
      await queryClient.invalidateQueries({
        queryKey: agentKeys.conversations(record),
      });
      // The steps it took in that conversation went with it.
      await queryClient.invalidateQueries({
        queryKey: agentKeys.activity(record),
      });
    },
  });

  const work = (
    <AgentWork
      record={record}
      conversations={conversations}
      openConversationId={current?.id ?? null}
      defaultOpen={current === null}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-2">
        <ConversationPicker
          conversations={conversations}
          current={current}
          onSelect={setOpenId}
          onNew={() => setOpenId(null)}
        />
        {current ? (
          <InlineConfirm
            label="Delete this conversation"
            confirmLabel="Delete"
            pending={remove.isPending}
            onConfirm={() => remove.mutate(current.id)}
          />
        ) : null}
      </div>
      {current ? (
        // The thread's code loads, then useAgentChat suspends while it reads
        // the conversation's messages.
        <Suspense fallback={<PanelLoading />}>
          <ConversationThread
            key={current.id}
            record={record}
            conversation={current}
            header={work}
            canChat={canChat}
            firstMessage={
              firstMessage?.conversationId === current.id
                ? firstMessage.text
                : null
            }
            onFirstMessageSent={() => setFirstMessage(null)}
          />
        </Suspense>
      ) : (
        <ThreadFrame
          header={work}
          footer={
            canChat ? (
              <>
                {refused ? <AgentUnavailable /> : null}
                <AgentComposer
                  placeholder={RECORD_COPY[record.kind].placeholder}
                  busy={start.isPending}
                  onSend={(text) => start.mutate(text)}
                />
              </>
            ) : (
              <AgentUnavailable />
            )
          }
        >
          <AgentIdle
            kind={record.kind}
            onAsk={
              canChat && !start.isPending
                ? (text) => start.mutate(text)
                : undefined
            }
          />
        </ThreadFrame>
      )}
    </div>
  );
}

function ConversationPicker({
  conversations,
  current,
  onSelect,
  onNew,
}: {
  conversations: Conversation[];
  current: Conversation | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const unread = conversations.some(
    (row) => row.unread && row.id !== current?.id,
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="min-w-0 flex-1 justify-start font-normal"
          />
        }
      >
        <span className="truncate">
          {current ? (current.title ?? "Untitled") : "New conversation"}
        </span>
        {unread ? (
          <span
            className="size-1.5 shrink-0 rounded-full bg-primary"
            title="Unread"
          />
        ) : null}
        <ChevronDown data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 max-w-[90vw]">
        {conversations.length === 0 ? (
          <DropdownMenuItem disabled>Nothing yet</DropdownMenuItem>
        ) : (
          conversations.map((row) => (
            <DropdownMenuItem key={row.id} onClick={() => onSelect(row.id)}>
              <span className="min-w-0 flex-1 truncate">
                {row.title ?? "Untitled"}
              </span>
              {row.unread ? (
                <span className="size-1.5 shrink-0 rounded-full bg-primary">
                  <span className="sr-only">Unread</span>
                </span>
              ) : null}
              <span className="shrink-0 text-xs text-muted-foreground">
                <LocalDateTime date={row.lastMessageAt} />
              </span>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onNew}>
          <Plus />
          New conversation
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
