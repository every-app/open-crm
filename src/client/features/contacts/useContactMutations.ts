import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  pausedResearchMessage,
  useAgentPaused,
} from "@/client/features/agent/AgentPaused";
import { contactKeys } from "@/client/features/contacts/contactQueries";
import { useInvalidateRecords } from "@/client/features/records/recordQueries";
import { useCanManageWorkspace } from "@/client/features/settings/settingsQueries";
import {
  getErrorCode,
  getStandardErrorMessage,
} from "@/client/lib/error-messages";
import { setPrimaryContact } from "@/serverFunctions/companies";
import {
  archiveContact,
  decideContactFact,
  enrichContact,
  purgeContact,
  restoreContact,
  updateContact,
} from "@/serverFunctions/contacts";
import type {
  DecideFactInput,
  UpdateContactInput,
} from "@/types/schemas/contacts";

type ContactPatch = Omit<UpdateContactInput, "id">;

/**
 * Copy for a failed contact write. A taken email's comes from the server,
 * which names the contact who has it.
 */
export function contactErrorMessage(
  error: unknown,
  about?: "email" | "fact",
): string {
  const code = getErrorCode(error);
  if (code === "CONFLICT" && about === "fact") {
    return "That suggestion has already been settled.";
  }
  if (code === "VALIDATION_ERROR" && about === "email") {
    return "That is not an email address.";
  }
  return getStandardErrorMessage(error);
}

/** Everything a contact's sheet changes, each refetching what it shows on. */
export function useContactMutations(
  contactId: string,
  { onPurged }: { onPurged: () => void },
) {
  const invalidate = useInvalidateRecords();
  const record = contactKeys.detail(contactId);
  const paused = useAgentPaused();
  const canManage = useCanManageWorkspace();

  const update = useMutation({
    mutationFn: (patch: ContactPatch) =>
      updateContact({ data: { id: contactId, ...patch } }),
    onSuccess: () => invalidate({ record }),
    onError: (error, patch) =>
      toast.error(
        contactErrorMessage(error, "email" in patch ? "email" : undefined),
      ),
  });

  const archive = useMutation({
    mutationFn: () => archiveContact({ data: { id: contactId } }),
    onSuccess: async (contact) => {
      toast.success(`${contact.name} archived.`);
      await invalidate();
    },
  });

  const restore = useMutation({
    mutationFn: () => restoreContact({ data: { id: contactId } }),
    onSuccess: async (contact) => {
      toast.success(`${contact.name} restored.`);
      await invalidate();
    },
  });

  const purge = useMutation({
    mutationFn: () => purgeContact({ data: { id: contactId } }),
    onSuccess: async (contact) => {
      toast.success(`${contact.name} deleted forever.`);
      onPurged();
      await invalidate({ gone: record });
    },
  });

  const enrich = useMutation({
    mutationFn: () => enrichContact({ data: { id: contactId } }),
    onSuccess: async (result) => {
      // Queued either way; while the agent's model isn't set up it runs by
      // itself once the key lands, so say so instead of "Research queued."
      if (paused) {
        toast.warning(pausedResearchMessage(canManage));
      } else {
        toast.success(result.queued ? "Research queued." : "Already running.");
      }
      await invalidate();
    },
  });

  const setPrimary = useMutation({
    mutationFn: (companyId: string) =>
      setPrimaryContact({ data: { companyId, contactId } }),
    onSuccess: async () => {
      toast.success("Primary contact updated.");
      await invalidate();
    },
  });

  const decide = useMutation({
    mutationFn: (input: DecideFactInput) => decideContactFact({ data: input }),
    onSuccess: async (result) => {
      toast.success(
        result.applied
          ? "Added to the record."
          : "Dismissed. It won't be suggested again.",
      );
      await invalidate({ record });
    },
    onError: async (error) => {
      toast.error(contactErrorMessage(error, "fact"));
      // Someone else settled it: show what the record says now.
      await invalidate({ record });
    },
  });

  return { update, archive, restore, purge, enrich, setPrimary, decide };
}
