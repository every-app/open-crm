import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { companyKeys } from "@/client/features/companies/companyQueries";
import { contactKeys } from "@/client/features/contacts/contactQueries";
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
 * Refetches contacts and companies: a contact's writes show on companies too
 * (their people, counts and primary contact).
 */
export function invalidateContacts(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: contactKeys.all }),
    queryClient.invalidateQueries({ queryKey: companyKeys.all }),
  ]);
}

/** Copy for a failed contact write: the server sends only the code. */
export function contactErrorMessage(
  error: unknown,
  about?: "email" | "restore" | "fact",
): string {
  const code = getErrorCode(error);
  if (code === "CONFLICT" && about === "fact") {
    return "That suggestion has already been settled.";
  }
  if (code === "CONFLICT") {
    return about === "restore"
      ? "A live contact already uses this contact's email address. Change or archive that one first."
      : "Another contact already uses that email address.";
  }
  if (code === "VALIDATION_ERROR" && about === "email") {
    return "That is not an email address.";
  }
  return getStandardErrorMessage(error);
}

/** Everything a contact's sheet changes, each refetching what it shows. */
export function useContactMutations(
  contactId: string,
  { onPurged }: { onPurged: () => void },
) {
  const queryClient = useQueryClient();
  const invalidate = () => invalidateContacts(queryClient);

  const update = useMutation({
    mutationFn: (patch: ContactPatch) =>
      updateContact({ data: { id: contactId, ...patch } }),
    onSuccess: invalidate,
    onError: (error, patch) =>
      toast.error(
        contactErrorMessage(error, "email" in patch ? "email" : undefined),
      ),
  });

  const archive = useMutation({
    mutationFn: () => archiveContact({ data: { id: contactId } }),
    onSuccess: async (contact) => {
      toast.success(`${contact.name} was archived.`);
      await invalidate();
    },
  });

  const restore = useMutation({
    mutationFn: () => restoreContact({ data: { id: contactId } }),
    onSuccess: async (contact) => {
      toast.success(`${contact.name} was restored.`);
      await invalidate();
    },
    onError: (error) => toast.error(contactErrorMessage(error, "restore")),
  });

  const purge = useMutation({
    mutationFn: () => purgeContact({ data: { id: contactId } }),
    onSuccess: async (contact) => {
      toast.success(`${contact.name} was deleted forever.`);
      onPurged();
      // The closing sheet still shows the contact: everything else refetches,
      // and its own query is left to expire rather than read a 404.
      const gone = contactKeys.detail(contactId).join("/");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: contactKeys.all,
          predicate: (query) => query.queryKey.join("/") !== gone,
        }),
        queryClient.invalidateQueries({ queryKey: companyKeys.all }),
      ]);
    },
  });

  const enrich = useMutation({
    mutationFn: () => enrichContact({ data: { id: contactId } }),
    onSuccess: async (result) => {
      toast.success(
        result.queued
          ? "Taking another look — this page will update when it finishes."
          : "Already running.",
      );
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
      await invalidate();
    },
    onError: async (error) => {
      toast.error(contactErrorMessage(error, "fact"));
      // Someone else settled it: show what the record says now.
      await invalidate();
    },
  });

  return { update, archive, restore, purge, enrich, setPrimary, decide };
}
