import {
  createFileRoute,
  Outlet,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import {
  SectionLayout,
  SectionNavLink,
} from "@/client/components/SectionLayout";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsLayout,
});

const sections = [
  { to: "/settings", label: "Workspace", exact: true },
  { to: "/settings/ai", label: "AI", exact: false },
  { to: "/settings/connections", label: "Connections", exact: false },
] as const;

function SettingsLayout() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const navigate = useNavigate();
  const current =
    sections.find((section) =>
      section.exact ? pathname === section.to : pathname.startsWith(section.to),
    )?.to ?? "/settings";
  return (
    <SectionLayout
      label="Workspace settings"
      mobileNav={
        <Select
          items={sections.map((section) => ({
            value: section.to,
            label: section.label,
          }))}
          value={current}
          onValueChange={(value) => {
            const section = sections.find((item) => item.to === value);
            if (section) void navigate({ to: section.to });
          }}
        >
          <SelectTrigger aria-label="Settings section" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sections.map((section) => (
              <SelectItem key={section.to} value={section.to}>
                {section.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
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
