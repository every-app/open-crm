import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Archive, ArchiveRestore, MoreHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import {
  changeTeamAgentStatus,
  deleteTeamAgent,
  type getTeamAgent,
} from "@/serverFunctions/teamAgents";
import { useAgentMutation } from "./agentEditing";
import { teamAgentKeys } from "./teamAgentQueries";

type Agent = Awaited<ReturnType<typeof getTeamAgent>>;

/**
 * The agent's ⋯ menu (the CRM's "More agent actions"): archive it, restore an
 * archived one, or delete it once confirmed.
 */
export function AgentActionsMenu({ agent }: { agent: Agent }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState(false);
  const transition = useAgentMutation(
    agent.id,
    (action: "archive" | "restore") =>
      changeTeamAgentStatus({ data: { agentId: agent.id, action } }),
    "Saved.",
  );
  const remove = useMutation({
    mutationFn: () => deleteTeamAgent({ data: { agentId: agent.id } }),
    onSuccess: async () => {
      toast.success(`${agent.name} was deleted.`);
      await queryClient.invalidateQueries({ queryKey: teamAgentKeys.list() });
      await navigate({ to: "/agents" });
    },
  });
  const deployed = agent.status === "LIVE" || agent.status === "PAUSED";
  const archived = agent.status === "ARCHIVED";
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="icon"
              aria-label="More agent actions"
              pending={transition.isPending}
            />
          }
        >
          {transition.isPending ? null : <MoreHorizontal />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          {deployed ? (
            <DropdownMenuItem onClick={() => transition.mutate("archive")}>
              <Archive />
              Archive agent
            </DropdownMenuItem>
          ) : null}
          {archived ? (
            <DropdownMenuItem onClick={() => transition.mutate("restore")}>
              <ArchiveRestore />
              Restore agent
            </DropdownMenuItem>
          ) : null}
          {deployed || archived ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setDeleting(true)}
          >
            <Trash2 />
            Delete agent
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {deleting ? (
        <ConfirmDialog
          title={`Delete ${agent.name}?`}
          confirmLabel="Delete agent"
          destructive
          pending={remove.isPending}
          onConfirm={() => remove.mutate()}
          onClose={() => setDeleting(false)}
        >
          This disables its triggers and cancels queued runs.
        </ConfirmDialog>
      ) : null}
    </>
  );
}
