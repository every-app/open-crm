import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, ChevronLeft } from "lucide-react";
import { AgentUnavailable } from "@/client/features/agent/AgentThreadParts";
import { agentStatusQueryOptions } from "@/client/features/settings/settingsQueries";
import { createBuilderChat } from "@/serverFunctions/teamAgents";
import { BuilderComposer, type BuilderMessage } from "./BuilderComposer";
import { teamAgentKeys } from "./teamAgentQueries";
import { BUILDER_SUGGESTIONS } from "./teamAgentCopy";

declare module "@tanstack/react-router" {
  interface HistoryState {
    /** The message a builder chat opens with, sent once it connects. */
    builderFirstMessage?: BuilderMessage;
  }
}

/**
 * Where a builder chat starts (the CRM's builder home): ask about the CRM, or
 * describe an agent. The chat exists once there is something to say in it.
 */
export function BuilderHome() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const status = useQuery(agentStatusQueryOptions());
  // As in a record's chat: only no way to a model at all closes the
  // composer; after a refusal the next message is the next try.
  const canChat = status.data?.model !== "missing";
  const [suggestion, setSuggestion] = useState<string | null>(null);

  const start = useMutation({
    mutationFn: (_message: BuilderMessage) => createBuilderChat(),
    onSuccess: async (chat, message) => {
      await queryClient.invalidateQueries({ queryKey: teamAgentKeys.chats() });
      await navigate({
        to: "/agents/chat/$conversationId",
        params: { conversationId: chat.id },
        state: { builderFirstMessage: message },
      });
    },
  });

  return (
    <div className="h-full overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <Link
          to="/agents"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden />
          Agents
        </Link>
        <div className="space-y-2 pt-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            What should an agent do for the team?
          </h1>
          <p className="text-sm text-balance text-muted-foreground">
            Ask about your CRM, tag a record or integration, or switch on Create
            agent and describe a job to automate.
          </p>
        </div>
        <BuilderComposer
          key={suggestion ?? ""}
          conversationId={null}
          busy={start.isPending || !canChat}
          initialText={suggestion ?? ""}
          initialCreating={suggestion !== null}
          onSend={(message) => start.mutate(message)}
        />
        {canChat ? null : <AgentUnavailable />}
        <p className="text-xs text-muted-foreground">
          Chats and agent drafts stay private to you. Deploying an agent makes
          it available to the whole team.
        </p>
        <div>
          <p className="pb-1 text-xs text-muted-foreground">Suggested agents</p>
          {BUILDER_SUGGESTIONS.map((text) => (
            <button
              key={text}
              type="button"
              onClick={() => setSuggestion(text)}
              className="flex h-10 w-full items-center border-t border-border text-left text-sm hover:bg-muted/50"
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
