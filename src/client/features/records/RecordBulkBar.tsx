import { useState, type ReactNode } from "react";
import { Archive, RefreshCw, Trash2, Undo2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import {
  TableBulkActionBar,
  TableBulkActionButton,
} from "@/client/components/table/TableBulkActionBar";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { ownerIdOf, useOwnerOptions } from "@/client/features/records/owners";
import type { BulkResult } from "@/types/schemas/records";

// What a list does to its selected rows: live ones get an owner, the agent,
// or the archive; archived ones come back or (owners and admins) go for good.

export type RecordNoun = { one: string; many: string };

/** "1 company", "3 companies". */
function countOf(count: number, noun: RecordNoun): string {
  return `${count.toLocaleString()} ${count === 1 ? noun.one : noun.many}`;
}

/**
 * Says how a bulk action went: what it did (`done` gets "3 companies"),
 * and why any records were left alone.
 */
export function reportBulk(
  result: BulkResult,
  noun: RecordNoun,
  done: (count: string) => string,
): void {
  const why = result.error
    ? getStandardErrorMessage(new Error(result.error))
    : null;
  if (result.succeeded === 0) {
    toast.error(why ?? "Nothing changed.");
    return;
  }
  const message = done(countOf(result.succeeded, noun));
  if (result.failed > 0) {
    const leftAlone = `${result.failed.toLocaleString()} ${result.failed === 1 ? "was" : "were"} left alone`;
    toast.warning(`${message} ${leftAlone}${why ? `: ${why}` : "."}`);
    return;
  }
  toast.success(message);
}

export function RecordBulkBar({
  selectedCount,
  noun,
  archived,
  canPurge,
  pending,
  onClear,
  onAssignOwner,
  onEnrich,
  onArchive,
  onRestore,
  onPurge,
  actions,
}: {
  selectedCount: number;
  noun: RecordNoun;
  /** The Archived view's selection: restore or delete forever. */
  archived: boolean;
  canPurge: boolean;
  /** A bulk action is running. */
  pending: boolean;
  onClear: () => void;
  onAssignOwner: (ownerId: string | null) => void;
  /** Companies and contacts send the agent; deals have no enrichment. */
  onEnrich?: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onPurge: () => void;
  /** More actions for live records, such as setting a contact's company. */
  actions?: ReactNode;
}) {
  const owners = useOwnerOptions("Nobody");
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <TableBulkActionBar
        selectedCount={selectedCount}
        onClear={onClear}
        actions={
          <div className="flex items-center gap-0.5 p-1">
            {archived ? (
              <>
                <TableBulkActionButton
                  icon={<Undo2 />}
                  onClick={onRestore}
                  disabled={pending}
                >
                  Restore
                </TableBulkActionButton>
                {canPurge ? (
                  <TableBulkActionButton
                    variant="danger"
                    icon={<Trash2 />}
                    onClick={() => setConfirming(true)}
                    disabled={pending}
                  >
                    Delete forever
                  </TableBulkActionButton>
                ) : null}
              </>
            ) : (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button variant="ghost" size="sm" disabled={pending} />
                    }
                  >
                    <UserRound />
                    Assign owner
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    side="top"
                    align="start"
                    className="max-h-72 min-w-48"
                  >
                    {owners.map((owner) => (
                      <DropdownMenuItem
                        key={owner.value}
                        onClick={() => onAssignOwner(ownerIdOf(owner.value))}
                      >
                        {owner.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                {actions}
                {onEnrich ? (
                  <TableBulkActionButton
                    icon={<RefreshCw />}
                    onClick={onEnrich}
                    disabled={pending}
                  >
                    Enrich
                  </TableBulkActionButton>
                ) : null}
                <TableBulkActionButton
                  icon={<Archive />}
                  onClick={onArchive}
                  disabled={pending}
                >
                  Archive
                </TableBulkActionButton>
              </>
            )}
          </div>
        }
      />
      {confirming ? (
        <ConfirmDialog
          title={`Delete ${countOf(selectedCount, noun)} forever?`}
          confirmLabel="Delete forever"
          destructive
          onConfirm={() => {
            setConfirming(false);
            onPurge();
          }}
          onClose={() => setConfirming(false)}
        >
          This cannot be undone. Everything filed against them is deleted with
          them.
        </ConfirmDialog>
      ) : null}
    </>
  );
}
