import {
  BookUser,
  CircleDollarSign,
  LayoutDashboard,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { linkOptions, type LinkOptions } from "@tanstack/react-router";

type NavItem = {
  label: string;
  icon: LucideIcon;
  link: LinkOptions;
  activePaths?: readonly string[];
};

/** The primary navigation. Contacts come first: opening the CRM lands there. */
export const navItems: NavItem[] = [
  {
    label: "Directory",
    icon: BookUser,
    link: linkOptions({ to: "/contacts" }),
    activePaths: ["/companies"],
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
  },
];

/** Workspace utilities stay at the sidebar's foot. */
export const settingsNavItem: NavItem = {
  label: "Settings",
  icon: Settings,
  link: linkOptions({ to: "/settings" }),
};
