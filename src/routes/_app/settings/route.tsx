import { createFileRoute, Outlet } from "@tanstack/react-router";
import {
  SectionLayout,
  SectionNavLink,
} from "@/client/components/SectionLayout";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsLayout,
});

// The original CRM's settings, in its order.
const sections = [
  { to: "/settings", label: "General", exact: true },
  { to: "/settings/tracking", label: "Tracking & Analytics", exact: false },
  { to: "/settings/connections", label: "Connections", exact: false },
  { to: "/settings/currencies", label: "Currencies", exact: false },
  { to: "/settings/members", label: "Members", exact: false },
  { to: "/settings/api-keys", label: "API Keys", exact: false },
  { to: "/settings/sso", label: "SSO", exact: false },
] as const;

function SettingsLayout() {
  return (
    <SectionLayout
      label="Workspace settings"
      nav={sections.map((section) => (
        <SectionNavLink
          key={section.to}
          to={section.to}
          activeOptions={{ exact: section.exact, includeSearch: false }}
        >
          {section.label}
        </SectionNavLink>
      ))}
    >
      <Outlet />
    </SectionLayout>
  );
}
