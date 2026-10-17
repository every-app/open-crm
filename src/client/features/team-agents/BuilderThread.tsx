import { useEffect, useRef, useState } from "react";
import { getAgentMessages, useAgentChat } from "@cloudflare/think/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useAgent } from "agents/react";
import type { UIMessage } from "ai";
import { Paperclip, ThumbsDown, ThumbsUp } from "lucide-react";
import { z } from "zod";
import {
  ChatMessage,
  messageHasVisibleContent,
} from "@/client/components/chat/ChatMessage";
import { useStickToBottom } from "@/client/components/chat/useStickToBottom";
import { EmptyState } from "@/client/components/EmptyState";
import { ErrorState } from "@/client/components/ErrorState";
import { Button } from "@/client/components/ui/button";
import { QuestionComposer } from "@/client/features/agent/AgentQuestion";
import {
  AgentUnavailable,
  ThreadFrame,
} from "@/client/features/agent/AgentThreadParts";
import {
  ASK_QUESTION,
  type QuestionAnswer,
} from "@/client/features/agent/askQuestion";
import { pendingQuestion } from "@/client/features/agent/agentTranscript";
import { ToolPart } from "@/client/features/agent/ConversationThread";
import type { getBuilderChat } from "@/serverFunctions/teamAgents";
import {
  markBuilderChatRead,
  rateBuilderReply,
} from "@/serverFunctions/teamAgents";
import { BuilderComposer, type BuilderMessage } from "./BuilderComposer";
import { builderAskQuestionTool } from "./builderQuestion";
import { teamAgentKeys } from "./teamAgentQueries";

type Chat = Awaited<ReturnType<typeof getBuilderChat>>;

const extras = z
  .object({
    resources: z.array(z.object({ label: z.string() })).catch([]),
    attachments: z
      .array(z.object({ id: z.string(), name: z.string() }))
      .catch([]),
  })
  .partial()
  .catch({});

/**
 * The builder conversation, over the chat's CrmAgent session like a record
 * chat (the Worker authorizes the socket, agentRoutes.ts). The builder may
 * stop to ask one question, answered in place of the composer.
 */
export function BuilderThread({
  chat,
  canChat,
}: {
  chat: Chat;
  canChat: boolean;
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

  const send = (message: BuilderMessage) => {
    pinToBottom();
    void sendMessage({ text: message.text, metadata: message.metadata });
  };

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

  // While the builder works, its files and draft land beside the chat.
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
          conversationId={conversation.id}
          busy={busy}
          onSend={send}
          onStop={() => void stop()}
        />
      )}
    </>
  );

  return (
    <ThreadFrame
      header={null}
      footer={footer}
      scrollRef={scrollRef}
      onScroll={onScroll}
    >
      {messages.length === 0 && !busy ? (
        <EmptyState
          variant="plain"
          size="sm"
          title="Ask about your CRM, or build an agent"
          description="Switch on Create agent and say when it should run, what it should look at and what it should do. You review the draft before anything runs."
        />
      ) : null}
      {messages.map((message, index) => (
        <div key={message.id} className="space-y-1">
          <ChatMessage
            message={message}
            streaming={
              busy &&
              index === messages.length - 1 &&
              message.role === "assistant"
            }
            renderTool={(part, live) => (
              <ToolPart part={part} live={live} hidden={question?.toolCallId} />
            )}
          />
          {message.role === "user" ? <MessageExtras message={message} /> : null}
          {message.role === "assistant" &&
          !(busy && index === messages.length - 1) ? (
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
      ))}
      {showTyping ? (
        <div className="flex items-center gap-1.5 pt-1 text-muted-foreground">
          <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
          <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
          <span className="size-1.5 animate-bounce rounded-full bg-current" />
        </div>
      ) : null}
      {status === "error" ? (
        <ErrorState
          variant="inline"
          message="The builder stopped before finishing this reply."
          onRetry={canChat ? () => void regenerate() : undefined}
          isRetrying={busy}
        />
      ) : null}
    </ThreadFrame>
  );
}

/** The records a message tagged and the files it attached. */
function MessageExtras({ message }: { message: UIMessage }) {
  const { resources = [], attachments = [] } = extras.parse(message.metadata);
  if (resources.length === 0 && attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {resources.map((resource) => (
        <span
          key={resource.label}
          className="rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground"
        >
          @{resource.label}
        </span>
      ))}
      {attachments.map((file) => (
        <a
          key={file.id}
          href={`/api/agent-attachments/${encodeURIComponent(file.id)}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <Paperclip className="size-3" />
          {file.name}
        </a>
      ))}
    </div>
  );
}

/** Thumbs up or down on a reply; pressing the same one again clears it. */
function Feedback({
  conversationId,
  messageId,
  rating,
}: {
  conversationId: string;
  messageId: string;
  rating: "UP" | "DOWN" | null;
}) {
  const queryClient = useQueryClient();
  const rate = useMutation({
    mutationFn: (next: "UP" | "DOWN" | null) =>
      rateBuilderReply({ data: { conversationId, messageId, rating: next } }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: teamAgentKeys.chat(conversationId),
      }),
  });
  const choose = (value: "UP" | "DOWN") =>
    rate.mutate(rating === value ? null : value);
  return (
    <div className="flex gap-0.5">
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Rate response helpful"
        aria-pressed={rating === "UP"}
        className={
          rating === "UP" ? "text-foreground" : "text-muted-foreground"
        }
        onClick={() => choose("UP")}
      >
        <ThumbsUp />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Rate response not helpful"
        aria-pressed={rating === "DOWN"}
        className={
          rating === "DOWN" ? "text-foreground" : "text-muted-foreground"
        }
        onClick={() => choose("DOWN")}
      >
        <ThumbsDown />
      </Button>
    </div>
  );
}
