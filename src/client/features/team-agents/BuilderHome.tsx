import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { AgentUnavailable } from "@/client/features/agent/AgentThreadParts";
import { agentStatusQueryOptions } from "@/client/features/settings/settingsQueries";
import { BuilderComposer } from "./BuilderComposer";
import { BUILDER_SUGGESTIONS } from "./teamAgentCopy";
import { useStartChat } from "./useStartChat";

declare module "@tanstack/react-router" {
  interface HistoryState {
    /** An agent to start describing, as Settings → Slack's suggestions give. */
    builderDraft?: string;
  }
}

/**
 * Chat's home (the CRM's builder home): ask about the CRM, or describe an
 * agent. The chat exists once there is something to say in it, and starts
 * with that message and its files in one call.
 */
export function BuilderHome() {
  const status = useQuery(agentStatusQueryOptions());
  // As in a record's chat: only no way to a model at all closes the
  // composer; after a refusal the next message is the next try.
  const canChat = status.data?.model !== "missing";
  const draft = useLocation({
    select: (location) => location.state.builderDraft,
  });
  const [suggestion, setSuggestion] = useState<string | null>(draft ?? null);
  const start = useStartChat();

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4 pt-14 pb-20 sm:px-6 sm:pt-12 sm:pb-28">
      <h1 className="w-full max-w-3xl pb-6 text-center text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
        What can I help with?
      </h1>
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
        <div className="pt-4">
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
