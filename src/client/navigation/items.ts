import {
  BookUser,
  CircleDollarSign,
  LayoutDashboard,
  Bot,
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

/** The primary navigation, in the original CRM's order. */
export const navItems: NavItem[] = [
  {
    label: "Overview",
    icon: LayoutDashboard,
    // Without exact matching, the index path is a prefix of every route and
    // Overview would render active everywhere.
    link: linkOptions({
      to: "/",
      activeOptions: { exact: true, includeSearch: false },
    }),
  },
  {
    label: "Directory",
    icon: BookUser,
    link: linkOptions({ to: "/companies" }),
    activePaths: ["/contacts"],
  },
  {
    label: "Deals",
    icon: CircleDollarSign,
    link: linkOptions({ to: "/deals" }),
  },
  {
    label: "Agents",
    icon: Bot,
    link: linkOptions({ to: "/agents" }),
  },
];

/** Workspace utilities stay at the sidebar's foot. */
export const settingsNavItem: NavItem = {
  label: "Settings",
  icon: Settings,
  link: linkOptions({ to: "/settings" }),
};
