import { useSyncExternalStore } from "react";

// Whether the out-of-credits dialog is open. Every refusal for credits opens
// it (a refused action, a chat turn the agent couldn't take), so running out
// always looks the same; the person dismisses it each time.

let open = false;
const listeners = new Set<() => void>();

function setOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  for (const listener of listeners) listener();
}

/** A refusal for credits: show the dialog. */
export function showOutOfCredits(): void {
  setOpen(true);
}

/** The dialog's state, for OutOfCreditsDialog. */
export function useOutOfCreditsDialog() {
  const isOpen = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => open,
    () => false,
  );
  return { open: isOpen, close: () => setOpen(false) };
}
