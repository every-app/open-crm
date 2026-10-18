import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { companyKeys } from "@/client/features/companies/companyQueries";
import {
  getErrorCode,
  getStandardErrorMessage,
} from "@/client/lib/error-messages";
import {
  archiveCompany,
  enrichCompany,
  purgeCompany,
  restoreCompany,
  setPrimaryContact,
  updateCompany,
} from "@/serverFunctions/companies";
import type { UpdateCompanyInput } from "@/types/schemas/companies";

type CompanyPatch = Omit<UpdateCompanyInput, "id">;

/**
 * Copy for a failed company write. A taken domain's comes from the server,
 * which names the company that has it.
 */
export function companyErrorMessage(error: unknown, about?: "domain"): string {
  if (getErrorCode(error) === "VALIDATION_ERROR" && about === "domain") {
    return "That is not a domain. Enter one like acme.com.";
  }
  return getStandardErrorMessage(error);
}

/** Everything a company's sheet changes, each invalidating the companies. */
export function useCompanyMutations(
  companyId: string,
  { onPurged }: { onPurged: () => void },
) {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: companyKeys.all });

  const update = useMutation({
    mutationFn: (patch: CompanyPatch) =>
      updateCompany({ data: { id: companyId, ...patch } }),
    onSuccess: invalidate,
    onError: (error, patch) =>
      toast.error(
        companyErrorMessage(error, "domain" in patch ? "domain" : undefined),
      ),
  });

  const archive = useMutation({
    mutationFn: () => archiveCompany({ data: { id: companyId } }),
    onSuccess: async (company) => {
      toast.success(`${company.name} was archived.`);
      await invalidate();
    },
  });

  const restore = useMutation({
    mutationFn: () => restoreCompany({ data: { id: companyId } }),
    onSuccess: async (company) => {
      toast.success(`${company.name} was restored.`);
      await invalidate();
    },
  });

  const purge = useMutation({
    mutationFn: () => purgeCompany({ data: { id: companyId } }),
    onSuccess: async (company) => {
      toast.success(`${company.name} was deleted forever.`);
      onPurged();
      // The closing sheet still shows the company: everything else refetches,
      // and its own query is left to expire rather than read a 404.
      const gone = companyKeys.detail(companyId).join("/");
      await queryClient.invalidateQueries({
        queryKey: companyKeys.all,
        predicate: (query) => query.queryKey.join("/") !== gone,
      });
    },
  });

  const enrich = useMutation({
    mutationFn: () => enrichCompany({ data: { id: companyId } }),
    onSuccess: async (result) => {
      toast.success(result.queued ? "Looking it up." : "Already running.");
      await invalidate();
    },
  });

  const setPrimary = useMutation({
    mutationFn: (contactId: string | null) =>
      setPrimaryContact({ data: { companyId, contactId } }),
    onSuccess: invalidate,
  });

  return { update, archive, restore, purge, enrich, setPrimary };
}
