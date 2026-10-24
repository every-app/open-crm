import { useState, type ReactNode } from "react";
import {
  Archive,
  ChevronDown,
  RefreshCw,
  Trash2,
  Undo2,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { useIsMobile } from "@/client/hooks/use-mobile";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { ownerIdOf, useOwnerOptions } from "@/client/features/records/owners";
import { UNASSIGNED, type BulkResult } from "@/types/schemas/records";

// What a list does to its selected rows, from the Actions menu that takes
// the toolbar's place while rows are selected: live ones get an owner, the
// agent, or the archive; archived ones come back or (owners and admins) go
// for good.

export type RecordNoun = { one: string; many: string };

/** "1 company", "3 companies". */
function countOf(count: number, noun: RecordNoun): string {
  return `${count.toLocaleString()} ${count === 1 ? noun.one : noun.many}`;
}

/**
 * Says how a bulk action went: what it did (`done` gets "3 companies"),
 * and why any records were left alone, in the server's words when it has
 * them ("A live company already uses this company's domain…").
 */
export function reportBulk(
  result: BulkResult,
  noun: RecordNoun,
  done: (count: string) => string,
): void {
  const why =
    result.message ??
    (result.error ? getStandardErrorMessage(new Error(result.error)) : null);
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

/** One of the Actions menu's submenus. On a phone a tap opens it. */
export function BulkSubmenu({
  icon: Icon,
  label,
  className,
  children,
}: {
  icon: LucideIcon;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const tapToOpen = useIsMobile();
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger
        openOnHover={!tapToOpen}
        className="[&>svg:last-child]:text-muted-foreground"
      >
        <Icon className="text-muted-foreground" />
        {label}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className={className}>
        {children}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

export function RecordBulkMenu({
  noun,
  count,
  archived,
  canPurge,
  pending,
  open,
  onOpenChange,
  ownerRequired = false,
  onAssignOwner,
  onEnrich,
  onArchive,
  onRestore,
  onPurge,
  purgeWarning,
  children,
}: {
  noun: RecordNoun;
  /** How many rows are selected. */
  count: number;
  /** The Archived view's selection: restore or delete forever. */
  archived: boolean;
  canPurge: boolean;
  /** A bulk action is running. */
  pending: boolean;
  /** For a list that closes the menu itself, as after a pick in a search. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Records that always have an owner (deals) aren't offered "Nobody". */
  ownerRequired?: boolean;
  onAssignOwner: (ownerId: string | null) => void;
  /** Companies and contacts send the agent; deals have no enrichment. */
  onEnrich?: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onPurge: () => void;
  /** What deleting the selection forever means, for its confirmation. */
  purgeWarning: string;
  /** The list's own submenus, after Assign owner. */
  children?: ReactNode;
}) {
  const owners = useOwnerOptions("Nobody").filter(
    (owner) => !ownerRequired || owner.value !== UNASSIGNED,
  );
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger
          render={<Button variant="outline" size="sm" pending={pending} />}
        >
          Actions
          <ChevronDown
            data-icon="inline-end"
            className="text-muted-foreground"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {archived ? (
            <>
              <DropdownMenuItem onClick={onRestore}>
                <Undo2 />
                Restore
              </DropdownMenuItem>
              {canPurge ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setConfirming(true)}
                  >
                    <Trash2 />
                    Delete forever
                  </DropdownMenuItem>
                </>
              ) : null}
            </>
          ) : (
            <>
              <BulkSubmenu
                icon={UserRound}
                label="Assign owner"
                className="max-h-72 min-w-40"
              >
                {owners.map((owner) => (
                  <DropdownMenuItem
                    key={owner.value}
                    onClick={() => onAssignOwner(ownerIdOf(owner.value))}
                  >
                    {owner.label}
                  </DropdownMenuItem>
                ))}
              </BulkSubmenu>
              {children}
              {onEnrich ? (
                <DropdownMenuItem onClick={onEnrich}>
                  <RefreshCw />
                  Refresh research
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onArchive}>
                <Archive />
                Archive
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {confirming ? (
        <ConfirmDialog
          title={`Delete ${countOf(count, noun)} forever?`}
          confirmLabel="Delete forever"
          destructive
          onConfirm={() => {
            setConfirming(false);
            onPurge();
          }}
          onClose={() => setConfirming(false)}
        >
          {purgeWarning}
        </ConfirmDialog>
      ) : null}
    </>
  );
}
