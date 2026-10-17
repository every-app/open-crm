import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from "@/client/components/SettingsSection";
import { Button } from "@/client/components/ui/button";
import {
  changeTeamAgentStatus,
  deleteTeamAgent,
  type getTeamAgent,
} from "@/serverFunctions/teamAgents";
import { useAgentMutation } from "./agentEditing";
import { teamAgentKeys } from "./teamAgentQueries";

type Agent = Awaited<ReturnType<typeof getTeamAgent>>;

const DESTRUCTIVE_OUTLINE =
  "text-destructive hover:bg-destructive/10 hover:text-destructive";

/** Archiving, restoring and deleting the agent. */
export function AgentDangerZone({ agent }: { agent: Agent }) {
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
  return (
    <SettingsSection title="Danger zone">
      <SettingsCard>
        {deployed ? (
          <SettingsRow
            label="Archive agent"
            description="Its triggers don't run until it is restored."
          >
            <Button
              variant="outline"
              className={DESTRUCTIVE_OUTLINE}
              pending={transition.isPending}
              onClick={() => transition.mutate("archive")}
            >
              Archive
            </Button>
          </SettingsRow>
        ) : null}
        {agent.status === "ARCHIVED" ? (
          <SettingsRow
            label="Restore agent"
            description="Its triggers don't run. Restore it to pause it, then resume it to run again."
          >
            <Button
              variant="outline"
              pending={transition.isPending}
              onClick={() => transition.mutate("restore")}
            >
              Restore
            </Button>
          </SettingsRow>
        ) : null}
        <SettingsRow
          label="Delete agent"
          description="Its run and action history stays in the audit log."
        >
          <Button
            variant="outline"
            className={DESTRUCTIVE_OUTLINE}
            onClick={() => setDeleting(true)}
          >
            Delete agent
          </Button>
        </SettingsRow>
      </SettingsCard>
      {deleting ? (
        <ConfirmDialog
          title={`Delete ${agent.name}?`}
          confirmLabel="Delete agent"
          destructive
          pending={remove.isPending}
          onConfirm={() => remove.mutate()}
          onClose={() => setDeleting(false)}
        >
          This removes it from the team agent list, disables its triggers, and
          cancels queued runs. Its run and action history stays in the audit
          log. A run already in progress may finish.
        </ConfirmDialog>
      ) : null}
    </SettingsSection>
  );
}
