import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { activityKeys } from "@/client/features/activities/activityQueries";
import { companyKeys } from "@/client/features/companies/companyQueries";
import { contactKeys } from "@/client/features/contacts/contactQueries";
import { dashboardKeys } from "@/client/features/dashboard/dashboardQueries";
import { dealKeys } from "@/client/features/deals/dealQueries";
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

/**
 * Deals, the companies and contacts whose sheets and counts show them, the
 * timelines a stage move lands on, and Home's figures.
 */
export function useInvalidateDeals() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: dealKeys.all }),
      queryClient.invalidateQueries({ queryKey: companyKeys.all }),
      queryClient.invalidateQueries({ queryKey: contactKeys.all }),
      queryClient.invalidateQueries({ queryKey: activityKeys.all }),
      queryClient.invalidateQueries({ queryKey: dashboardKeys.all }),
    ]);
}

/** Moves a deal to another stage; each move lands on its timeline. */
export function useSetDealStage(onMoved?: (changed: boolean) => void) {
  const invalidate = useInvalidateDeals();
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
  const queryClient = useQueryClient();
  const invalidate = useInvalidateDeals();

  const update = useMutation({
    mutationFn: (patch: DealPatch) =>
      updateDeal({ data: { id: dealId, ...patch } }),
    onSuccess: invalidate,
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
      // The closing sheet still shows the deal: everything else refetches,
      // and its own query is left to expire rather than read a 404.
      const gone = dealKeys.detail(dealId).join("/");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: dealKeys.all,
          predicate: (query) => query.queryKey.join("/") !== gone,
        }),
        queryClient.invalidateQueries({ queryKey: companyKeys.all }),
      ]);
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
    onSuccess: invalidate,
  });

  const detachContact = useMutation({
    mutationFn: (contactId: string) =>
      detachDealContact({ data: { dealId, contactId } }),
    onSuccess: invalidate,
  });

  const setContactRole = useMutation({
    mutationFn: (input: { contactId: string; role: string | null }) =>
      setDealContactRole({ data: { dealId, ...input } }),
    onSuccess: invalidate,
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
