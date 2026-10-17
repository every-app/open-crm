import { SectionHeader } from "@/client/components/PageHeader";
import { SetupChecklist } from "@/client/features/setup/SetupChecklist";

/**
 * Settings → Agent: what the agent has to work with on this gateway. There
 * is nothing to paste here: the Every App gateway holds every key, and on a
 * fork an owner or admin sets each once there.
 */
export function AgentStatus() {
  return (
    <section className="space-y-3">
      <SectionHeader title="Agent" />
      <p className="max-w-2xl text-sm text-muted-foreground">
        The research agent reaches its model and company data through your Every
        App gateway, which holds their keys.
      </p>
      <SetupChecklist group="agent" />
    </section>
  );
}
