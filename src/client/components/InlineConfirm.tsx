import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/client/components/ui/button";

/**
 * Two-step delete for a list row: the trash icon swaps to an explicit
 * Remove/Cancel pair, so a stray click can't destroy anything and no dialog
 * is needed.
 */
export function InlineConfirm({
  label,
  confirmLabel = "Remove",
  pending,
  onConfirm,
}: {
  /** Accessible name of the trash button, for example "Remove openseo.so". */
  label: string;
  confirmLabel?: string;
  pending: boolean;
  onConfirm: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <>
        <Button
          variant="destructive"
          size="xs"
          disabled={pending}
          onClick={() => {
            setConfirming(false);
            onConfirm();
          }}
        >
          {confirmLabel}
        </Button>
        <Button variant="ghost" size="xs" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className="text-destructive hover:text-destructive"
      aria-label={label}
      disabled={pending}
      onClick={() => setConfirming(true)}
    >
      <Trash2 className="size-3.5" />
    </Button>
  );
}
