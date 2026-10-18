import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAgent } from "agents/react";
// Think speaks the same chat protocol as @cloudflare/ai-chat, but its hook
// variant skips the client->server transcript sync Think doesn't support.
import { getAgentMessages, useAgentChat } from "@cloudflare/think/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { z } from "zod";
import {
  ChatMessage,
  messageHasVisibleContent,
} from "@/client/components/chat/ChatMessage";
import { useStickToBottom } from "@/client/components/chat/useStickToBottom";
import { ErrorState } from "@/client/components/ErrorState";
import { Markdown } from "@/client/components/Markdown";
import { Button } from "@/client/components/ui/button";
import type { RecordRef } from "@/shared/records";
import { markAgentConversationRead } from "@/serverFunctions/agent";
import { AgentComposer } from "./AgentComposer";
import { ApprovalPrompt, approvalStep } from "./AgentApproval";
import { QuestionComposer } from "./AgentQuestion";
import { AgentStepLine } from "./AgentStepLine";
import { AgentIdle, AgentUnavailable, ThreadFrame } from "./AgentThreadParts";
import { RECORD_COPY } from "./agentCopy";
import { agentKeys } from "./agentQueries";
import { describeStep } from "./agentSteps";
import { pendingApproval, pendingQuestion } from "./agentTranscript";
import {
  ASK_QUESTION,
  askQuestionTool,
  parseQuestion,
  type QuestionAnswer,
} from "./askQuestion";
import { useOutOfCreditsReplies } from "@/client/features/billing/OutOfCreditsDialog";

type Conversation = {
  id: string;
  sessionId: string;
  agent: string;
  unread: boolean;
};

/**
 * One of the person's conversations about a record. Its messages live in the
 * conversation's CrmAgent Durable Object, so they survive a reload; the
 * WebSocket is authorized in the Worker (agentRoutes.ts) and closed by the
 * server every 15 minutes, after which the client reconnects on its own.
 */
export function ConversationThread({
  record,
  conversation,
  header,
  canChat,
  firstMessage,
  onFirstMessageSent,
}: {
  record: RecordRef;
  conversation: Conversation;
  header: ReactNode;
  canChat: boolean;
  /** The message that started this conversation, sent once on connect. */
  firstMessage: string | null;
  onFirstMessageSent: () => void;
}) {
  const queryClient = useQueryClient();
  const agent = useAgent({
    agent: conversation.agent,
    name: conversation.sessionId,
    // PartySocket assumes TLS on any host but a bare localhost; follow the
    // page instead (the local gateway serves crm.localhost over http).
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
    addToolApprovalResponse,
  } = useAgentChat({
    agent,
    // The saved messages, read from the page's own origin. A read that fails
    // starts empty rather than failing the page: Think sends the transcript
    // over the socket on every connect.
    getInitialMessages: ({ agent: agentName, name }) =>
      getAgentMessages({
        host: window.location.origin,
        agent: agentName,
        name,
      }),
    // The agent may ask the rep a question mid-turn (askQuestion.ts).
    body: { clientTools: [askQuestionTool] },
  });

  // isRecovering: the DO is settling a turn a reset interrupted (persisting
  // the partial reply). Nothing can be sent into it until that lands.
  const busy = status === "submitted" || isStreaming || isRecovering;
  const { scrollRef, onScroll, pinToBottom } = useStickToBottom(
    messages,
    status,
  );
  // A turn refused for credits opens the out-of-credits dialog.
  useOutOfCreditsReplies(messages, status);

  const send = (text: string) => {
    pinToBottom();
    void sendMessage({ text });
  };

  // A conversation started from the empty tab opens with that question, once
  // the socket is identified: Think sends the saved transcript on connect,
  // just before the identity, and a message sent earlier would be replaced
  // by that (still empty) transcript and never come back to this socket.
  const sentFirst = useRef(false);
  useEffect(() => {
    if (!firstMessage || !agent.identified || sentFirst.current) return;
    sentFirst.current = true;
    pinToBottom();
    void sendMessage({ text: firstMessage });
    onFirstMessageSent();
  }, [
    firstMessage,
    agent.identified,
    pinToBottom,
    sendMessage,
    onFirstMessageSent,
  ]);

  // The socket reconnects on its own after a drop (the server closes it every
  // 15 minutes); a close the server marks terminal sets connectionError and
  // stops retrying until the person asks. `identified` is false before the
  // first connect too, so "reconnecting" waits until one connect succeeded.
  const [hasConnected, setHasConnected] = useState(false);
  useEffect(() => {
    if (agent.identified) setHasConnected(true);
  }, [agent.identified]);
  const isReconnecting = hasConnected && !agent.identified && !connectionError;

  // The agent titles the conversation and files its steps during the turn:
  // once a turn settles, refetch both.
  const wasBusy = useRef(false);
  useEffect(() => {
    if (busy) {
      wasBusy.current = true;
      return;
    }
    if (!wasBusy.current) return;
    wasBusy.current = false;
    void queryClient.invalidateQueries({
      queryKey: agentKeys.conversations(record),
    });
    void queryClient.invalidateQueries({
      queryKey: agentKeys.activity(record),
    });
  }, [busy, queryClient, record]);

  // A reply the person has now seen is read.
  const { mutate: markRead } = useMutation({
    mutationFn: () =>
      markAgentConversationRead({
        data: { conversationId: conversation.id },
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: agentKeys.conversations(record),
      }),
    // Nothing to tell the person: the badge stays until the next read.
    meta: { errorToast: false },
  });
  useEffect(() => {
    if (conversation.unread && !busy) markRead();
  }, [conversation.unread, busy, markRead]);

  const question = busy ? null : pendingQuestion(messages);
  const approval = busy ? null : pendingApproval(messages);
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
          message="Connection lost."
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
      ) : isReconnecting ? (
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
      ) : approval ? (
        <ApprovalPrompt
          key={approval.approvalId}
          tool={approval.tool}
          input={approval.input}
          pending={busy}
          onDecide={(approved) =>
            addToolApprovalResponse({ id: approval.approvalId, approved })
          }
        />
      ) : (
        <AgentComposer
          placeholder={RECORD_COPY[record.kind].placeholder}
          busy={busy}
          onSend={send}
          onStop={() => void stop()}
        />
      )}
    </>
  );

  return (
    <ThreadFrame
      header={header}
      footer={footer}
      scrollRef={scrollRef}
      onScroll={onScroll}
    >
      {messages.length === 0 && !busy ? (
        <AgentIdle kind={record.kind} onAsk={canChat ? send : undefined} />
      ) : null}
      {messages.map((message, index) => (
        <ChatMessage
          key={message.id}
          message={message}
          streaming={
            busy &&
            index === messages.length - 1 &&
            message.role === "assistant"
          }
          renderTool={(part, live) => (
            <ToolPart
              part={part}
              live={live}
              // The open question is asked in place of the composer.
              hidden={question?.toolCallId}
            />
          )}
        />
      ))}
      {showTyping ? (
        <div className="flex items-center gap-1.5 pt-1 text-muted-foreground">
          <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
          <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
          <span className="size-1.5 animate-bounce rounded-full bg-current" />
        </div>
      ) : null}
      {isRecovering ? (
        <p className="text-xs text-muted-foreground">
          Saving the reply that got cut off…
        </p>
      ) : null}
      {status === "error" ? (
        <ErrorState
          variant="inline"
          message="The reply stopped early."
          onRetry={canChat ? () => void regenerate() : undefined}
          isRetrying={busy}
        />
      ) : null}
    </ThreadFrame>
  );
}

const answerSchema = z
  .object({ answer: z.string() })
  .transform((output) => output.answer)
  .nullable()
  .catch(null);

/** One tool call in a reply: a step, or one of the agent's questions. */
export function ToolPart({
  part,
  live,
  hidden,
}: {
  part: UIMessage["parts"][number];
  live: boolean;
  hidden: string | undefined;
}) {
  if (!isToolUIPart(part) || part.toolCallId === hidden) return null;
  const tool = getToolName(part);
  if (tool === ASK_QUESTION) {
    const answer =
      part.state === "output-available"
        ? answerSchema.parse(part.output)
        : null;
    return (
      <div className="max-w-md space-y-1 border-l-2 border-ring/50 bg-muted/40 px-3 py-2">
        <p className="text-xs font-medium">Follow-up</p>
        <Markdown className="text-sm [overflow-wrap:anywhere]">
          {parseQuestion(part.input).prompt}
        </Markdown>
        {answer ? (
          <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
            You answered: <span className="text-foreground">{answer}</span>
          </p>
        ) : null}
      </div>
    );
  }
  if (part.state === "approval-requested") {
    return <AgentStepLine step={approvalStep(tool, "waiting")} />;
  }
  if (part.state === "approval-responded" || part.state === "output-denied") {
    return (
      <AgentStepLine
        step={approvalStep(
          tool,
          part.approval.approved ? "approved" : "denied",
        )}
      />
    );
  }
  const done =
    part.state === "output-available" || part.state === "output-error";
  return (
    <AgentStepLine
      step={describeStep(tool, {
        output: part.state === "output-available" ? part.output : undefined,
        // A call still open in a reply that is no longer streaming never
        // finished: the turn was interrupted.
        failed: part.state === "output-error" || (!done && !live),
      })}
      pending={!done && live}
    />
  );
}
