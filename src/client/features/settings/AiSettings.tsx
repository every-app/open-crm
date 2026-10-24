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
        title="Company profiles (optional)"
        description="Context.dev fills in company profiles from their websites."
      >
        <SettingsCard>
          <GatewayKeyRow id="context" label="Context.dev API key" />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Agents">
        <SettingsCard>
          <SettingsRow
            label="Automations"
            description="Your AI client drafts agents. Review and deploy them on the Agents page."
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
