import { useState } from "react";
import { Archive, MoreHorizontal, Trash2, Undo2 } from "lucide-react";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";

/**
 * A record sheet's "more" menu: archive a live record; restore an archived
 * one, or (owners and admins) delete it forever after a confirmation that
 * says what goes with it.
 */
export function RecordActionsMenu({
  noun,
  name,
  archived,
  canPurge,
  consequence,
  pending,
  onArchive,
  onRestore,
  onPurge,
}: {
  /** "company", "contact" or "deal". */
  noun: string;
  name: string;
  archived: boolean;
  canPurge: boolean;
  /** What deleting it forever takes with it. */
  consequence: string;
  pending: boolean;
  onArchive: () => void;
  onRestore: () => void;
  onPurge: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`More actions for ${name}`}
              pending={pending}
            />
          }
        >
          {pending ? null : <MoreHorizontal />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          {archived ? (
            <>
              <DropdownMenuItem onClick={onRestore}>
                <Undo2 />
                Restore {noun}
              </DropdownMenuItem>
              {canPurge ? (
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setConfirming(true)}
                >
                  <Trash2 />
                  Delete {noun} forever
                </DropdownMenuItem>
              ) : null}
            </>
          ) : (
            <DropdownMenuItem onClick={onArchive}>
              <Archive />
              Archive {noun}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {confirming ? (
        <ConfirmDialog
          title={`Delete ${name} forever?`}
          confirmLabel="Delete forever"
          destructive
          onConfirm={() => {
            setConfirming(false);
            onPurge();
          }}
          onClose={() => setConfirming(false)}
        >
          {consequence} This cannot be undone.
        </ConfirmDialog>
      ) : null}
    </>
  );
}
