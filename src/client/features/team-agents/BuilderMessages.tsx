import { useMutation, useQueryClient } from "@tanstack/react-query";
import { isToolUIPart, type UIMessage } from "ai";
import { Bot, Paperclip, ThumbsDown, ThumbsUp } from "lucide-react";
import { z } from "zod";
import { ChatMessage } from "@/client/components/chat/ChatMessage";
import { Button } from "@/client/components/ui/button";
import { AgentStepLine } from "@/client/features/agent/AgentStepLine";
import { ToolPart } from "@/client/features/agent/ConversationThread";
import { rateBuilderReply } from "@/serverFunctions/teamAgents";
import {
  builderCommandType,
  consumeBuilderCommand,
} from "@/shared/builder-command";
import { PREVIEWABLE_IMAGE_TYPES } from "@/shared/team-agents";
import {
  dealListsOf,
  DealListSkeleton,
  DealListTable,
  isPendingDealList,
  withoutTables,
} from "./DealListResult";
import { builderStep } from "./builderSteps";
import { tagText } from "./TagPicker";
import { teamAgentKeys } from "./teamAgentQueries";

// A builder chat's messages, as the CRM's builder chat draws them: the
// person's (a request for an agent says so), and the builder's replies with
// their steps in its own words, a pipeline drawn as a deal table, and a
// rating.

type Part = UIMessage["parts"][number];

const extras = z
  .object({
    resources: z.array(z.object({ label: z.string() })).catch([]),
    attachments: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          mediaType: z.string().catch(""),
        }),
      )
      .catch([]),
  })
  .partial()
  .catch({});

function textOf(message: UIMessage): string {
  return message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n");
}

/** Whether a reply said anything: only those are rated. */
export function hasText(message: UIMessage): boolean {
  return textOf(message).trim().length > 0;
}

export function asksForAgent(message: UIMessage): boolean {
  return builderCommandType(textOf(message)) === "CREATE_AGENT";
}

/**
 * The person's message, without the "/Create agent" it may open with: a
 * request for an agent says so beside the records it tagged and the files it
 * attached.
 */
export function UserMessage({
  message,
  share,
}: {
  message: UIMessage;
  /** The link a shared chat was opened with, which opens its attachments. */
  share?: string;
}) {
  const shown: UIMessage = {
    ...message,
    parts: message.parts.map((part) =>
      part.type === "text"
        ? { ...part, text: consumeBuilderCommand(part.text) ?? part.text }
        : part,
    ),
  };
  const creates = asksForAgent(message);
  const { resources = [], attachments = [] } = extras.parse(message.metadata);
  return (
    <ChatMessage
      message={shown}
      extras={
        creates || resources.length > 0 || attachments.length > 0 ? (
          <div className="flex flex-wrap justify-end gap-1.5">
            {creates ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
                <Bot className="size-3" />
                Create agent
              </span>
            ) : null}
            {resources.map((resource) => (
              <span
                key={resource.label}
                className="rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground"
              >
                {tagText(resource.label)}
              </span>
            ))}
            {attachments.map((file) => {
              const href = `/api/agent-attachments/${encodeURIComponent(file.id)}${share ? `?share=${encodeURIComponent(share)}` : ""}`;
              return (
                <a
                  key={file.id}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground has-[img]:pl-0.5"
                >
                  {PREVIEWABLE_IMAGE_TYPES.has(file.mediaType.toLowerCase()) ? (
                    <img
                      src={href}
                      alt=""
                      className="size-4 rounded-sm object-cover"
                    />
                  ) : (
                    <Paperclip className="size-3" />
                  )}
                  {file.name}
                </a>
              );
            })}
          </div>
        ) : null
      }
    />
  );
}

/**
 * A reply: its steps in the builder's words, and a pipeline it read drawn as
 * a deal table in place of any table in its text.
 */
export function AssistantMessage({
  message,
  streaming,
  hidden,
}: {
  message: UIMessage;
  streaming: boolean;
  /** The open question's call, asked in place of the composer. */
  hidden: string | undefined;
}) {
  const dealLists = dealListsOf(message);
  const shown: UIMessage =
    dealLists.size === 0
      ? message
      : {
          ...message,
          parts: message.parts.map((part) =>
            part.type === "text"
              ? { ...part, text: withoutTables(part.text) }
              : part,
          ),
        };
  return (
    <ChatMessage
      message={shown}
      streaming={streaming}
      renderTool={(part, live) => {
        if (!isToolUIPart(part)) return null;
        const list = dealLists.get(part.toolCallId);
        return (
          <>
            <BuilderStep part={part} live={live} hidden={hidden} />
            {list ? (
              <DealListTable list={list} />
            ) : live && isPendingDealList(part) ? (
              <DealListSkeleton />
            ) : null}
          </>
        );
      }}
    />
  );
}

/** One tool call in a reply: the builder's own in its words, else a step. */
function BuilderStep({
  part,
  live,
  hidden,
}: {
  part: Part;
  live: boolean;
  hidden: string | undefined;
}) {
  const step = builderStep(part, live);
  if (!step) return <ToolPart part={part} live={live} hidden={hidden} />;
  const pending =
    live &&
    isToolUIPart(part) &&
    part.state !== "output-available" &&
    part.state !== "output-error";
  return <AgentStepLine step={step} pending={pending} />;
}

/** Thumbs up or down on a reply; pressing the same one again clears it. */
export function Feedback({
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
