import type { ListColor } from "@/types/schemas/lists";

/** Each list color's dot, as the sidebar, chips and boards draw it. */
export const LIST_DOT: Record<ListColor, string> = {
  gray: "bg-zinc-400",
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  purple: "bg-violet-500",
  pink: "bg-pink-500",
  teal: "bg-teal-500",
};

export const LIST_COLOR_LABELS: Record<ListColor, string> = {
  gray: "Gray",
  blue: "Blue",
  green: "Green",
  amber: "Amber",
  red: "Red",
  purple: "Purple",
  pink: "Pink",
  teal: "Teal",
};
