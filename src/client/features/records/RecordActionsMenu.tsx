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
  name,
  archived,
  canPurge,
  consequence,
  pending,
  onArchive,
  onRestore,
  onPurge,
}: {
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
                Restore
              </DropdownMenuItem>
              {canPurge ? (
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setConfirming(true)}
                >
                  <Trash2 />
                  Delete forever
                </DropdownMenuItem>
              ) : null}
            </>
          ) : (
            <DropdownMenuItem onClick={onArchive}>
              <Archive />
              Archive
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
          {consequence}
        </ConfirmDialog>
      ) : null}
    </>
  );
}
