import { useMutation } from "@tanstack/react-query";
import {
  RecordBulkMenu,
  reportBulk,
  type RecordNoun,
} from "@/client/features/records/RecordBulkMenu";
import { useInvalidateRecords } from "@/client/features/records/recordQueries";
import {
  bulkArchiveCompanies,
  bulkAssignCompanyOwner,
  bulkEnrichCompanies,
  bulkPurgeCompanies,
  bulkRestoreCompanies,
} from "@/serverFunctions/companies";
import type { BulkResult } from "@/types/schemas/records";

const NOUN: RecordNoun = { one: "company", many: "companies" };

/** What the companies list does to its selected rows. */
export function CompanyBulkActions({
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
  const invalidate = useInvalidateRecords();
  const settled = (done: (count: string) => string) => ({
    onSuccess: async (result: BulkResult) => {
      reportBulk(result, NOUN, done);
      onDone();
      await invalidate();
    },
  });

  const assign = useMutation({
    mutationFn: (input: { ids: string[]; ownerId: string | null }) =>
      bulkAssignCompanyOwner({ data: input }),
    ...settled((count) => `${count} reassigned.`),
  });
  const enrich = useMutation({
    mutationFn: (selected: string[]) =>
      bulkEnrichCompanies({ data: { ids: selected } }),
    ...settled((count) => `Looking up ${count}.`),
  });
  const archive = useMutation({
    mutationFn: (selected: string[]) =>
      bulkArchiveCompanies({ data: { ids: selected } }),
    ...settled((count) => `${count} archived.`),
  });
  const restore = useMutation({
    mutationFn: (selected: string[]) =>
      bulkRestoreCompanies({ data: { ids: selected } }),
    ...settled((count) => `${count} restored.`),
  });
  const purge = useMutation({
    mutationFn: (selected: string[]) =>
      bulkPurgeCompanies({ data: { ids: selected } }),
    ...settled((count) => `${count} deleted forever.`),
  });

  return (
    <RecordBulkMenu
      noun={NOUN}
      count={ids.length}
      archived={archived}
      canPurge={canPurge}
      pending={[assign, enrich, archive, restore, purge].some(
        (mutation) => mutation.isPending,
      )}
      onAssignOwner={(ownerId) => assign.mutate({ ids, ownerId })}
      onEnrich={() => enrich.mutate(ids)}
      onArchive={() => archive.mutate(ids)}
      onRestore={() => restore.mutate(ids)}
      onPurge={() => purge.mutate(ids)}
      purgeWarning="This cannot be undone."
    />
  );
}
