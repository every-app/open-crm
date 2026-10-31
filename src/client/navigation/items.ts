import {
  Building2,
  CircleDollarSign,
  LayoutDashboard,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import { linkOptions, type LinkOptions } from "@tanstack/react-router";

type NavItem = {
  label: string;
  icon: LucideIcon;
  link: LinkOptions;
  /** Only while deals are on (Settings → General). */
  dealsOnly?: boolean;
};

/**
 * The primary navigation. Contacts come first: opening the CRM lands there.
 * The lists follow in their own section (SidebarLists).
 */
export const navItems: NavItem[] = [
  { label: "Contacts", icon: Users, link: linkOptions({ to: "/contacts" }) },
  {
    label: "Companies",
    icon: Building2,
    link: linkOptions({ to: "/companies" }),
  },
  {
    label: "Overview",
    icon: LayoutDashboard,
    link: linkOptions({
      to: "/overview",
      activeOptions: { includeSearch: false },
    }),
  },
  {
    label: "Deals",
    icon: CircleDollarSign,
    link: linkOptions({ to: "/deals" }),
    dealsOnly: true,
  },
];

/** Workspace utilities stay at the sidebar's foot. */
export const settingsNavItem: NavItem = {
  label: "Settings",
  icon: Settings,
  link: linkOptions({ to: "/settings" }),
};
