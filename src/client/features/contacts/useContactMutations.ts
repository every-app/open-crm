import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { contactKeys } from "@/client/features/contacts/contactQueries";
import { useInvalidateRecords } from "@/client/features/records/recordQueries";
import {
  getErrorCode,
  getStandardErrorMessage,
} from "@/client/lib/error-messages";
import { setPrimaryContact } from "@/serverFunctions/companies";
import {
  archiveContact,
  purgeContact,
  restoreContact,
  updateContact,
} from "@/serverFunctions/contacts";
import type { UpdateContactInput } from "@/types/schemas/contacts";

type ContactPatch = Omit<UpdateContactInput, "id">;

/**
 * Copy for a failed contact write. A taken email's comes from the server,
 * which names the contact who has it.
 */
export function contactErrorMessage(error: unknown, about?: "email"): string {
  if (getErrorCode(error) === "VALIDATION_ERROR" && about === "email") {
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

  const setPrimary = useMutation({
    mutationFn: (companyId: string) =>
      setPrimaryContact({ data: { companyId, contactId } }),
    onSuccess: async () => {
      toast.success("Primary contact updated.");
      await invalidate();
    },
  });

  return { update, archive, restore, purge, setPrimary };
}
