import { Check } from "lucide-react";

/**
 * A checkbox drawn in a menu or list row, checked while the row (marked
 * `group/check`) is: a menu's checkbox item, or a list's selected option.
 */
export function RowCheckbox() {
  return (
    <span
      aria-hidden
      className="flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border border-input group-aria-checked/check:border-primary group-aria-checked/check:bg-primary group-aria-checked/check:text-primary-foreground group-aria-selected/check:border-primary group-aria-selected/check:bg-primary group-aria-selected/check:text-primary-foreground"
    >
      <Check className="hidden size-2.5 stroke-[3.5] group-aria-checked/check:block group-aria-selected/check:block" />
    </span>
  );
}
