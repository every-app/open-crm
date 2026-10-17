import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SettingsCardFooter } from "@/client/components/SettingsSection";
import { Button } from "@/client/components/ui/button";
import { reviseTeamAgent } from "@/serverFunctions/teamAgents";
import type { CaptureKind, RecordResource } from "@/shared/team-agents";
import { REVIEW_SAVED } from "./teamAgentCopy";
import { teamAgentKeys } from "./teamAgentQueries";

// What the agent page's cards share to save a change to the agent.

/** A mutation on the agent that refreshes it, its list and the chats. */
export function useAgentMutation<Input>(
  agentId: string,
  run: (input: Input) => Promise<unknown>,
  success: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: async () => {
      toast.success(success);
      await queryClient.invalidateQueries({
        queryKey: teamAgentKeys.agent(agentId),
      });
      await queryClient.invalidateQueries({ queryKey: teamAgentKeys.list() });
      await queryClient.invalidateQueries({ queryKey: teamAgentKeys.chats() });
    },
  });
}

type Change = {
  actions?: string[];
  channel?: { id: string; name: string };
  resources?: RecordResource[];
  sources?: CaptureKind[];
};

/** Saves one change to the deployed version's permissions. */
export function useRevise(agentId: string, onSaved: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (change: Change) =>
      reviseTeamAgent({
        data: { agentId, clientRequestId: crypto.randomUUID(), ...change },
      }),
    onSuccess: async (result) => {
      if (!result.saved) {
        toast.error(result.issues.join(" "));
        return;
      }
      onSaved();
      toast.success(
        result.review ? REVIEW_SAVED : "Saved. A new version is live.",
      );
      await queryClient.invalidateQueries({
        queryKey: teamAgentKeys.agent(agentId),
      });
    },
  });
}

/** A card's Save, disabled until something changes, and Discard. */
export function SaveFooter({
  note,
  dirty,
  blocked = false,
  pending,
  onDiscard,
  onSave,
}: {
  note: string | null;
  dirty: boolean;
  blocked?: boolean;
  pending: boolean;
  onDiscard: () => void;
  onSave: () => void;
}) {
  return (
    <SettingsCardFooter note={note}>
      {dirty ? (
        <Button variant="outline" disabled={pending} onClick={onDiscard}>
          Discard
        </Button>
      ) : null}
      <Button disabled={!dirty || blocked} pending={pending} onClick={onSave}>
        Save
      </Button>
    </SettingsCardFooter>
  );
}
