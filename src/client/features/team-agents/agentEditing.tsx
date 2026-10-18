import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { teamAgentKeys } from "./teamAgentQueries";

// What the agent page shares to change the agent.

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

/**
 * The page's one save bar (the CRM's SaveBar), shown once something changed:
 * Discard and Save, and a note when the change has a consequence. It rides
 * at the foot of the page while the page scrolls.
 */
export function SaveBar({
  note,
  blocked,
  pending,
  onDiscard,
  onSave,
}: {
  note: string | null;
  /** The change can't be saved as it stands; the note says why. */
  blocked: boolean;
  pending: boolean;
  onDiscard: () => void;
  onSave: () => void;
}) {
  return (
    <div className="sticky bottom-4 z-10 mt-auto flex max-w-2xl animate-in items-center gap-4 self-center rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-lg duration-200 fade-in-0 slide-in-from-bottom-4">
      {note ? (
        <p className="min-w-0 pl-2 text-sm text-muted-foreground">{note}</p>
      ) : null}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={onDiscard}
        >
          Discard
        </Button>
        <Button size="sm" disabled={blocked} pending={pending} onClick={onSave}>
          Save
        </Button>
      </div>
    </div>
  );
}
