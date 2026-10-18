import { createFileRoute, Outlet } from "@tanstack/react-router";
import {
  SectionLayout,
  SectionNavLink,
} from "@/client/components/SectionLayout";
import { useBillingEnabled } from "@/client/features/billing/billingQueries";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsLayout,
});

// The original CRM's settings, in its order (SSO left out for now), then
// Billing where usage is billed (hosted).
const sections = [
  { to: "/settings", label: "General", exact: true },
  { to: "/settings/tracking", label: "Tracking & Analytics", exact: false },
  { to: "/settings/connections", label: "Connections", exact: false },
  { to: "/settings/currencies", label: "Currencies", exact: false },
  { to: "/settings/members", label: "Members", exact: false },
  { to: "/settings/api-keys", label: "API Keys", exact: false },
] as const;

const billingSection = {
  to: "/settings/billing",
  label: "Billing",
  exact: false,
} as const;

function SettingsLayout() {
  const billing = useBillingEnabled();
  return (
    <SectionLayout
      label="Workspace settings"
      nav={[...sections, ...(billing ? [billingSection] : [])].map(
        (section) => (
          <SectionNavLink
            key={section.to}
            to={section.to}
            activeOptions={{ exact: section.exact, includeSearch: false }}
          >
            {section.label}
          </SectionNavLink>
        ),
      )}
    >
      <Outlet />
    </SectionLayout>
  );
}
