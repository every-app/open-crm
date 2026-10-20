import {
  Building2,
  CircleDollarSign,
  LayoutDashboard,
  MessagesSquare,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import { linkOptions, type LinkOptions } from "@tanstack/react-router";

type NavItem = {
  label: string;
  icon: LucideIcon;
  link: LinkOptions;
  /** Another path prefix that counts as this item. */
  related?: string;
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
    label: "Chat",
    icon: MessagesSquare,
    link: linkOptions({ to: "/chat" }),
    // Team agents come out of chats, so their pages sit under Chat too.
    related: "/agents",
  },
  {
    label: "Companies",
    icon: Building2,
    link: linkOptions({ to: "/companies" }),
  },
  { label: "Contacts", icon: Users, link: linkOptions({ to: "/contacts" }) },
  {
    label: "Deals",
    icon: CircleDollarSign,
    link: linkOptions({ to: "/deals" }),
  },
];

/** Settings, at the sidebar's foot under the way back to Every App. */
export const settingsNavItem: NavItem = {
  label: "Settings",
  icon: Settings,
  link: linkOptions({ to: "/settings" }),
};
