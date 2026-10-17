import {
  Bot,
  Building2,
  CircleDollarSign,
  LayoutDashboard,
  ListTodo,
  Users,
} from "lucide-react";
import { linkOptions } from "@tanstack/react-router";

const homeNavItem = linkOptions({
  to: "/" as const,
  label: "Home",
  icon: LayoutDashboard,
  // Without exact matching, the index path is a prefix of every route and
  // Home would render active everywhere.
  activeOptions: { exact: true, includeSearch: false },
});

const recordNavItems = linkOptions([
  { to: "/companies" as const, label: "Companies", icon: Building2 },
  { to: "/contacts" as const, label: "Contacts", icon: Users },
  { to: "/deals" as const, label: "Deals", icon: CircleDollarSign },
]);

const workNavItems = linkOptions([
  { to: "/tasks" as const, label: "My tasks", icon: ListTodo },
  { to: "/agents" as const, label: "Agents", icon: Bot },
]);

export const navGroups = [
  { label: "Overview", items: [homeNavItem, ...workNavItems] },
  { label: "Records", items: recordNavItems },
];
