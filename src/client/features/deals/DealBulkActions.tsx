import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Milestone } from "lucide-react";
import { DropdownMenuItem } from "@/client/components/ui/dropdown-menu";
import {
  CloseReasonDialog,
  DealStageIndicator,
} from "@/client/features/deals/DealStage";
import { useInvalidateDeals } from "@/client/features/deals/useDealMutations";
import {
  BulkSubmenu,
  RecordBulkMenu,
  reportBulk,
  type RecordNoun,
} from "@/client/features/records/RecordBulkMenu";
import {
  bulkArchiveDeals,
  bulkAssignDealOwner,
  bulkPurgeDeals,
  bulkRestoreDeals,
  bulkSetDealStage,
} from "@/serverFunctions/deals";
import type { DealStage } from "@/shared/crm-enums";
import { DEAL_STAGE_ORDER, isLosingStage } from "@/shared/deal-stages";
import type { BulkResult } from "@/types/schemas/records";

const NOUN: RecordNoun = { one: "deal", many: "deals" };

/** What the deals list does to its selected rows. */
export function DealBulkActions({
  ids,
  archived,
  canPurge,
  onDone,
}: {
  ids: string[];
  archived: boolean;
  canPurge: boolean;
  onDone: () => void;
}) {
  const invalidate = useInvalidateDeals();
  // The deals being closed, kept from when the stage was picked.
  const [closing, setClosing] = useState<{
    stage: DealStage;
    ids: string[];
  } | null>(null);
  const settled = (done: (count: string) => string) => ({
    onSuccess: async (result: BulkResult) => {
      reportBulk(result, NOUN, done);
      onDone();
      await invalidate();
    },
  });

  const assign = useMutation({
    mutationFn: (input: { ids: string[]; ownerId: string }) =>
      bulkAssignDealOwner({ data: input }),
    ...settled((count) => `${count} reassigned.`),
  });
  const move = useMutation({
    mutationFn: (input: {
      ids: string[];
      stage: DealStage;
      closedReason?: string;
    }) => bulkSetDealStage({ data: input }),
    ...settled((count) => `${count} moved.`),
  });
  const archive = useMutation({
    mutationFn: (selected: string[]) =>
      bulkArchiveDeals({ data: { ids: selected } }),
    ...settled((count) => `${count} archived.`),
  });
  const restore = useMutation({
    mutationFn: (selected: string[]) =>
      bulkRestoreDeals({ data: { ids: selected } }),
    ...settled((count) => `${count} restored.`),
  });
  const purge = useMutation({
    mutationFn: (selected: string[]) =>
      bulkPurgeDeals({ data: { ids: selected } }),
    ...settled((count) => `${count} deleted forever.`),
  });

  return (
    <>
      <RecordBulkMenu
        noun={NOUN}
        count={ids.length}
        archived={archived}
        canPurge={canPurge}
        pending={[assign, move, archive, restore, purge].some(
          (mutation) => mutation.isPending,
        )}
        ownerRequired
        onAssignOwner={(ownerId) => {
          if (ownerId) assign.mutate({ ids, ownerId });
        }}
        onArchive={() => archive.mutate(ids)}
        onRestore={() => restore.mutate(ids)}
        onPurge={() => purge.mutate(ids)}
        purgeWarning="Everything filed against them — activity, notes, the amounts in your pipeline — goes too. This cannot be undone."
      >
        <BulkSubmenu icon={Milestone} label="Change stage" className="min-w-48">
          {DEAL_STAGE_ORDER.map((stage) => (
            <DropdownMenuItem
              key={stage}
              onClick={() =>
                isLosingStage(stage)
                  ? setClosing({ stage, ids })
                  : move.mutate({ ids, stage })
              }
            >
              <DealStageIndicator stage={stage} />
            </DropdownMenuItem>
          ))}
        </BulkSubmenu>
      </RecordBulkMenu>
      {closing ? (
        <CloseReasonDialog
          stage={closing.stage}
          count={closing.ids.length}
          onClose={() => setClosing(null)}
          onSave={async (closedReason) => {
            await move.mutateAsync({ ...closing, closedReason });
            setClosing(null);
          }}
        />
      ) : null}
    </>
  );
}
