import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  pausedResearchMessage,
  useAgentPaused,
} from "@/client/features/agent/AgentPaused";
import { companyKeys } from "@/client/features/companies/companyQueries";
import { useInvalidateRecords } from "@/client/features/records/recordQueries";
import { useCanManageWorkspace } from "@/client/features/settings/settingsQueries";
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

/** Everything a company's sheet changes, each refetching what it shows on. */
export function useCompanyMutations(
  companyId: string,
  { onPurged }: { onPurged: () => void },
) {
  const invalidate = useInvalidateRecords();
  const record = companyKeys.detail(companyId);
  const paused = useAgentPaused();
  const canManage = useCanManageWorkspace();

  const update = useMutation({
    mutationFn: (patch: CompanyPatch) =>
      updateCompany({ data: { id: companyId, ...patch } }),
    onSuccess: () => invalidate({ record }),
    onError: (error, patch) =>
      toast.error(
        companyErrorMessage(error, "domain" in patch ? "domain" : undefined),
      ),
  });

  const archive = useMutation({
    mutationFn: () => archiveCompany({ data: { id: companyId } }),
    onSuccess: async (company) => {
      toast.success(`${company.name} archived.`);
      await invalidate();
    },
  });

  const restore = useMutation({
    mutationFn: () => restoreCompany({ data: { id: companyId } }),
    onSuccess: async (company) => {
      toast.success(`${company.name} restored.`);
      await invalidate();
    },
  });

  const purge = useMutation({
    mutationFn: () => purgeCompany({ data: { id: companyId } }),
    onSuccess: async (company) => {
      toast.success(`${company.name} deleted forever.`);
      onPurged();
      await invalidate({ gone: record });
    },
  });

  const enrich = useMutation({
    mutationFn: () => enrichCompany({ data: { id: companyId } }),
    onSuccess: async (result) => {
      // The request is queued either way; while the agent's model isn't set
      // up it runs by itself once the key lands, so say so instead of
      // "Research queued."
      if (paused) {
        toast.warning(pausedResearchMessage(canManage));
      } else {
        toast.success(result.queued ? "Research queued." : "Already running.");
      }
      await invalidate();
    },
  });

  const setPrimary = useMutation({
    mutationFn: (contactId: string | null) =>
      setPrimaryContact({ data: { companyId, contactId } }),
    onSuccess: () => invalidate(),
  });

  return { update, archive, restore, purge, enrich, setPrimary };
}
