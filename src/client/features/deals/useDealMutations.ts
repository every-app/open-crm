import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { dealKeys } from "@/client/features/deals/dealQueries";
import { useInvalidateRecords } from "@/client/features/records/recordQueries";
import {
  getErrorCode,
  getStandardErrorMessage,
} from "@/client/lib/error-messages";
import {
  archiveDeal,
  attachDealContact,
  detachDealContact,
  purgeDeal,
  restoreDeal,
  setDealContactRole,
  setDealStage,
  updateDeal,
} from "@/serverFunctions/deals";
import type { SetDealStageInput } from "@/types/schemas/deals";

/** A change to a deal's fields, as the server function takes it. */
export type DealPatch = Omit<Parameters<typeof updateDeal>[0]["data"], "id">;

/** Moves a deal to another stage; each move lands on its timeline. */
export function useSetDealStage(onMoved?: (changed: boolean) => void) {
  const invalidate = useInvalidateRecords();
  return useMutation({
    mutationFn: (input: SetDealStageInput) => setDealStage({ data: input }),
    onSuccess: async (result) => {
      onMoved?.(result.changed);
      await invalidate();
    },
    onError: (error) =>
      toast.error(
        getErrorCode(error) === "CONFLICT"
          ? "Someone moved this deal meanwhile. Check its stage and try again."
          : getStandardErrorMessage(error),
      ),
  });
}

/** Everything a deal's sheet changes. */
export function useDealMutations(
  dealId: string,
  { onPurged }: { onPurged: () => void },
) {
  const invalidate = useInvalidateRecords();
  const record = dealKeys.detail(dealId);

  const update = useMutation({
    mutationFn: (patch: DealPatch) =>
      updateDeal({ data: { id: dealId, ...patch } }),
    onSuccess: () => invalidate({ record }),
  });

  const archive = useMutation({
    mutationFn: () => archiveDeal({ data: { id: dealId } }),
    onSuccess: async (deal) => {
      toast.success(`${deal.name} was archived.`);
      await invalidate();
    },
  });

  const restore = useMutation({
    mutationFn: () => restoreDeal({ data: { id: dealId } }),
    onSuccess: async (deal) => {
      toast.success(`${deal.name} was restored.`);
      await invalidate();
    },
  });

  const purge = useMutation({
    mutationFn: () => purgeDeal({ data: { id: dealId } }),
    onSuccess: async (deal) => {
      toast.success(`${deal.name} was deleted forever.`);
      onPurged();
      await invalidate({ gone: record });
    },
    onError: (error) =>
      toast.error(
        getErrorCode(error) === "CONFLICT"
          ? "The deal was restored before it could be deleted."
          : getStandardErrorMessage(error),
      ),
  });

  const attachContact = useMutation({
    mutationFn: (input: { contactId: string; role: string | null }) =>
      attachDealContact({ data: { dealId, ...input } }),
    onSuccess: () => invalidate(),
  });

  const detachContact = useMutation({
    mutationFn: (contactId: string) =>
      detachDealContact({ data: { dealId, contactId } }),
    onSuccess: () => invalidate({ record }),
  });

  const setContactRole = useMutation({
    mutationFn: (input: { contactId: string; role: string | null }) =>
      setDealContactRole({ data: { dealId, ...input } }),
    onSuccess: () => invalidate({ record }),
  });

  return {
    update,
    archive,
    restore,
    purge,
    attachContact,
    detachContact,
    setContactRole,
  };
}
