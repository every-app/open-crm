import { useEffect, useRef, useState } from "react";
import { getAgentMessages, useAgentChat } from "@cloudflare/think/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useAgent } from "agents/react";
import { toast } from "sonner";
import { messageHasVisibleContent } from "@/client/components/chat/ChatMessage";
import { useStickToBottom } from "@/client/components/chat/useStickToBottom";
import { ErrorState } from "@/client/components/ErrorState";
import { Button } from "@/client/components/ui/button";
import { QuestionComposer } from "@/client/features/agent/AgentQuestion";
import { AgentUnavailable } from "@/client/features/agent/AgentThreadParts";
import {
  ASK_QUESTION,
  type QuestionAnswer,
} from "@/client/features/agent/askQuestion";
import { pendingQuestion } from "@/client/features/agent/agentTranscript";
import type { getBuilderChat } from "@/serverFunctions/teamAgents";
import { markBuilderChatRead } from "@/serverFunctions/teamAgents";
import {
  BuilderComposer,
  uploadAttachments,
  type ComposerMessage,
} from "./BuilderComposer";
import {
  AssistantMessage,
  asksForAgent,
  buildProgress,
  Feedback,
  hasText,
  UserMessage,
} from "./BuilderMessages";
import { builderAskQuestionTool } from "./builderQuestion";
import { AgentCodeWorkspace } from "./AgentCodeWorkspace";
import {
  BuilderFailureCard,
  BuildingAgentCard,
  DeployedAgentCard,
  ReviewAgentCard,
} from "./DraftCards";
import { teamAgentKeys } from "./teamAgentQueries";
import { CREATE_AGENT_PREFIX } from "./teamAgentCopy";

type Chat = Awaited<ReturnType<typeof getBuilderChat>>;

/**
 * The builder conversation, over the chat's CrmAgent session like a record
 * chat (the Worker authorizes the socket, agentRoutes.ts). The builder may
 * stop to ask one question, answered in place of the composer. Under the
 * conversation sit the agent it makes, as it is built, saved and deployed.
 */
export function BuilderThread({
  chat,
  canChat,
  onWorkingChange,
}: {
  chat: Chat;
  canChat: boolean;
  /** Whether a turn is running, for the page's header. */
  onWorkingChange: (working: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { conversation } = chat;
  const agent = useAgent({
    agent: conversation.agent,
    name: conversation.sessionId,
    protocol: window.location.protocol === "https:" ? "wss" : "ws",
  });
  const {
    messages,
    sendMessage,
    status,
    stop,
    regenerate,
    isStreaming,
    isRecovering,
    connectionError,
    addToolOutput,
  } = useAgentChat({
    agent,
    getInitialMessages: ({ agent: agentName, name }) =>
      getAgentMessages({
        host: window.location.origin,
        agent: agentName,
        name,
      }),
    body: { clientTools: [builderAskQuestionTool] },
  });
  const busy = status === "submitted" || isStreaming || isRecovering;
  const { scrollRef, onScroll, pinToBottom } = useStickToBottom(
    messages,
    status,
  );

  useEffect(() => {
    onWorkingChange(busy);
  }, [busy, onWorkingChange]);

  // A message's files are kept in the chat first, then the message names
  // them.
  const send = useMutation({
    mutationFn: async ({ text, resources, files }: ComposerMessage) => {
      const attachments = await uploadAttachments(conversation.id, files);
      pinToBottom();
      void sendMessage({ text, metadata: { resources, attachments } });
    },
  });

  // The message the chat was started with on the builder home, sent once the
  // socket is identified, then dropped from history so a reload can't resend.
  const firstMessage = useRouterState({
    select: (state) => state.location.state.builderFirstMessage,
  });
  const sentFirst = useRef(false);
  useEffect(() => {
    if (!firstMessage || !agent.identified || sentFirst.current) return;
    sentFirst.current = true;
    pinToBottom();
    void sendMessage({
      text: firstMessage.text,
      metadata: firstMessage.metadata,
    });
    void navigate({ to: ".", replace: true, state: {} });
  }, [firstMessage, agent.identified, pinToBottom, sendMessage, navigate]);

  // While the builder works, its files and draft land in the chat.
  const wasBusy = useRef(false);
  useEffect(() => {
    const refresh = () => {
      void queryClient.invalidateQueries({
        queryKey: teamAgentKeys.chat(conversation.id),
      });
      void queryClient.invalidateQueries({ queryKey: teamAgentKeys.chats() });
    };
    if (busy) {
      wasBusy.current = true;
      const timer = setInterval(refresh, 3_000);
      return () => clearInterval(timer);
    }
    if (wasBusy.current) {
      wasBusy.current = false;
      refresh();
      void queryClient.invalidateQueries({ queryKey: teamAgentKeys.list() });
    }
    return undefined;
  }, [busy, queryClient, conversation.id]);

  const { mutate: markRead } = useMutation({
    mutationFn: () =>
      markBuilderChatRead({ data: { conversationId: conversation.id } }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: teamAgentKeys.chats() }),
    meta: { errorToast: false },
  });
  useEffect(() => {
    if (conversation.unread && !busy) markRead();
  }, [conversation.unread, busy, markRead]);

  const [hasConnected, setHasConnected] = useState(false);
  useEffect(() => {
    if (agent.identified) setHasConnected(true);
  }, [agent.identified]);

  const question = busy ? null : pendingQuestion(messages);
  const lastMessage = messages.at(-1);
  const showTyping =
    busy &&
    (lastMessage?.role !== "assistant" ||
      !messageHasVisibleContent(lastMessage));

  // The agent this chat makes: a turn that asks for one builds it, then the
  // saved draft waits for review, then the deployed agent can run.
  const requests = messages.filter((message) => message.role === "user");
  const creatingAgent = requests.some(asksForAgent);
  const lastRequest = requests.at(-1);
  const lastCreates = lastRequest ? asksForAgent(lastRequest) : false;
  const building = busy && lastCreates;
  const madeAgent = conversation.madeAgent;
  const review = chat.version?.status === "READY" ? chat.version : null;

  const footer = (
    <>
      {connectionError ? (
        <ErrorState
          variant="inline"
          message="Lost the connection to the builder."
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => agent.reconnect()}
            >
              Reconnect
            </Button>
          }
        />
      ) : hasConnected && !agent.identified ? (
        <p className="text-xs text-muted-foreground">Reconnecting…</p>
      ) : null}
      {!canChat ? (
        <AgentUnavailable />
      ) : question ? (
        <QuestionComposer
          key={question.toolCallId}
          question={question.question}
          pending={busy}
          onAnswer={(answer) => {
            pinToBottom();
            addToolOutput({
              toolCallId: question.toolCallId,
              toolName: ASK_QUESTION,
              output: { answer } satisfies QuestionAnswer,
            });
          }}
        />
      ) : (
        <BuilderComposer
          mode="chat"
          busy={busy}
          onSend={(message) => send.mutateAsync(message)}
          onStop={() => void stop()}
        />
      )}
    </>
  );

  return (
    <>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6 sm:px-5 sm:py-9">
          {messages.map((message, index) => {
            if (message.role === "user") {
              return <UserMessage key={message.id} message={message} />;
            }
            const streaming = busy && index === messages.length - 1;
            // A reply that ended before saying anything has nothing to show.
            if (!streaming && !messageHasVisibleContent(message)) return null;
            return (
              <div key={message.id} className="space-y-1">
                <AssistantMessage
                  message={message}
                  streaming={streaming}
                  hidden={question?.toolCallId}
                />
                {!streaming && hasText(message) ? (
                  <Feedback
                    conversationId={conversation.id}
                    messageId={message.id}
                    rating={
                      chat.feedback.find((row) => row.messageId === message.id)
                        ?.rating ?? null
                    }
                  />
                ) : null}
              </div>
            );
          })}
          {showTyping && !building ? (
            <div className="flex items-center gap-1.5 pt-1 text-muted-foreground">
              <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
              <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
              <span className="size-1.5 animate-bounce rounded-full bg-current" />
            </div>
          ) : null}
          {building ? (
            <BuildingAgentCard
              {...buildProgress(messages)}
              onStop={() => {
                void stop();
                toast.success("Stop requested.");
              }}
            />
          ) : null}
          {creatingAgent && chat.files.length > 0 ? (
            <AgentCodeWorkspace files={chat.files} working={building} />
          ) : null}
          {status === "error" ? (
            <BuilderFailureCard
              creatingAgent={lastCreates}
              retrying={busy}
              onRetry={canChat ? () => void regenerate() : null}
            />
          ) : null}
          {creatingAgent && !busy && review && madeAgent ? (
            <ReviewAgentCard
              agentId={madeAgent.id}
              agentName={madeAgent.name ?? ""}
              manifest={review.manifest}
            />
          ) : null}
          {creatingAgent && madeAgent?.status === "LIVE" && !review ? (
            <DeployedAgentCard
              agentId={madeAgent.id}
              onFollowUp={(text) => {
                pinToBottom();
                void sendMessage({
                  text: `${CREATE_AGENT_PREFIX}${text}`,
                  metadata: { resources: [], attachments: [] },
                });
              }}
            />
          ) : null}
        </div>
      </div>
      <div className="shrink-0 border-t border-border px-4 py-3 sm:px-5">
        <div className="mx-auto w-full max-w-3xl space-y-2">{footer}</div>
      </div>
    </>
  );
}
