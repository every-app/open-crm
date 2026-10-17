import { createFileRoute } from "@tanstack/react-router";
import { SectionHeader } from "@/client/components/PageHeader";
import { SetupChecklist } from "@/client/features/setup/SetupChecklist";

export const Route = createFileRoute("/_app/settings/setup")({
  component: SetupSettings,
});

function SetupSettings() {
  return (
    <section className="space-y-3">
      <SectionHeader title="Setup" />
      <p className="max-w-2xl text-sm text-muted-foreground">
        What your Every App gateway has set up for the CRM, and what each piece
        unlocks. The CRM works without them.
      </p>
      <SetupChecklist />
    </section>
  );
}
