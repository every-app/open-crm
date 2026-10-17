import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { AgentUnavailable } from "@/client/features/agent/AgentThreadParts";
import { agentStatusQueryOptions } from "@/client/features/settings/settingsQueries";
import { createBuilderChat } from "@/serverFunctions/teamAgents";
import {
  BuilderComposer,
  uploadAttachments,
  type BuilderMessage,
  type ComposerMessage,
} from "./BuilderComposer";
import { teamAgentKeys } from "./teamAgentQueries";
import { BUILDER_SUGGESTIONS } from "./teamAgentCopy";

declare module "@tanstack/react-router" {
  interface HistoryState {
    /** The message a builder chat opens with, sent once it connects. */
    builderFirstMessage?: BuilderMessage;
    /** An agent to start describing, as Settings → Slack's suggestions give. */
    builderDraft?: string;
  }
}

/**
 * Chat's home (the CRM's builder home): ask about the CRM, or describe an
 * agent. The chat exists once there is something to say in it, and the
 * files the first message attaches are kept in it then.
 */
export function BuilderHome() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const status = useQuery(agentStatusQueryOptions());
  // As in a record's chat: only no way to a model at all closes the
  // composer; after a refusal the next message is the next try.
  const canChat = status.data?.model !== "missing";
  const draft = useLocation({
    select: (location) => location.state.builderDraft,
  });
  const [suggestion, setSuggestion] = useState<string | null>(draft ?? null);

  const start = useMutation({
    mutationFn: async ({ text, resources, files }: ComposerMessage) => {
      const chat = await createBuilderChat();
      const attachments = await uploadAttachments(chat.id, files);
      return { chat, message: { text, metadata: { resources, attachments } } };
    },
    onSuccess: async ({ chat, message }) => {
      await queryClient.invalidateQueries({ queryKey: teamAgentKeys.chats() });
      await navigate({
        to: "/chat/$chatId",
        params: { chatId: chat.id },
        state: { builderFirstMessage: message },
      });
    },
  });

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4 pt-14 pb-20 sm:px-6 sm:pt-12 sm:pb-28">
      <div className="flex w-full max-w-3xl flex-col items-center gap-3 pb-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          What can I help with?
        </h1>
        <p className="max-w-xl text-sm text-balance text-muted-foreground">
          Ask about your CRM, tag a record or integration, or describe an agent
          to build to automate a task.
        </p>
      </div>
      <div className="w-full max-w-3xl">
        <BuilderComposer
          key={suggestion ?? ""}
          mode="home"
          busy={start.isPending || !canChat}
          initialText={suggestion ?? ""}
          initialCreating={suggestion !== null}
          onSend={(message) => start.mutateAsync(message)}
        />
        {canChat ? null : (
          <div className="pt-2">
            <AgentUnavailable />
          </div>
        )}
        <p className="flex min-h-8 items-center py-1 text-xs text-muted-foreground">
          Chats and agent drafts stay private to you. Deploying an agent makes
          it available to the whole team.
        </p>
        <div className="pt-1">
          <p className="flex h-7 items-center text-xs text-muted-foreground">
            Suggested agents
          </p>
          {BUILDER_SUGGESTIONS.map((text) => (
            <button
              key={text}
              type="button"
              onClick={() => setSuggestion(text)}
              className="flex h-[42px] w-full items-center border-t border-border text-left text-sm outline-none transition-colors hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.03]"
            >
              <span className="min-w-0 flex-1 font-medium">{text}</span>
              <ArrowRight className="size-4 text-muted-foreground" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
