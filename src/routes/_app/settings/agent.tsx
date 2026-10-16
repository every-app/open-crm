import { createFileRoute } from "@tanstack/react-router";
import { AgentModelPicker } from "@/client/features/settings/AgentModelPicker";
import { AgentStatus } from "@/client/features/settings/AgentStatus";

export const Route = createFileRoute("/_app/settings/agent")({
  component: AgentSettings,
});

function AgentSettings() {
  return (
    <div className="space-y-10">
      <AgentModelPicker />
      <AgentStatus />
    </div>
  );
}
