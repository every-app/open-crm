import { createFileRoute, Outlet } from "@tanstack/react-router";
import { NavTab, NavTabs } from "@/client/components/NavTabs";
import { PageHeader } from "@/client/components/PageHeader";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsLayout,
});

const tabs = [
  { to: "/settings", label: "Workspace", exact: true },
  { to: "/settings/members", label: "Members", exact: false },
  { to: "/settings/currencies", label: "Currencies", exact: false },
  { to: "/settings/agent", label: "Agent", exact: false },
  { to: "/settings/tracking", label: "Tracking", exact: false },
  { to: "/settings/data", label: "Data", exact: false },
] as const;

function SettingsLayout() {
  return (
    <div className="h-full overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="space-y-4">
          <PageHeader title="Settings" />
          <NavTabs label="Settings sections">
            {tabs.map((tab) => (
              <NavTab
                key={tab.to}
                to={tab.to}
                activeOptions={{ exact: tab.exact }}
              >
                {tab.label}
              </NavTab>
            ))}
          </NavTabs>
        </div>

        <Outlet />
      </div>
    </div>
  );
}
