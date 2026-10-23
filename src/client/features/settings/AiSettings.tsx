import { Link } from "@tanstack/react-router";
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "@/client/components/SettingsSection";
import { Button } from "@/client/components/ui/button";
import { GatewayKeyRow } from "./GatewayKeyRow";
import { ResearchAgentSection } from "./ResearchAgentSection";

export function AiSettings() {
  return (
    <SettingsPage title="AI">
      <div id="model" className="scroll-mt-6">
        <ResearchAgentSection />
      </div>
      <SettingsSection
        id="company-research"
        title="Optional company enrichment"
        description="Context.dev fills in company profiles from their websites."
      >
        <SettingsCard>
          <GatewayKeyRow id="context" label="Context.dev API key" />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Team agents">
        <SettingsCard>
          <SettingsRow
            label="Automations"
            description="Create drafts with your AI client, then review and deploy them here."
          >
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link to="/agents" />}
            >
              Manage agents
            </Button>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  );
}
