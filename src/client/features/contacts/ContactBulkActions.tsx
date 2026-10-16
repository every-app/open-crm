import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { FormDialog } from "@/client/components/FormDialog";
import { TableBulkActionButton } from "@/client/components/table/TableBulkActionBar";
import { Button } from "@/client/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@/client/components/ui/field";
import { invalidateContacts } from "@/client/features/contacts/useContactMutations";
import {
  CompanyPicker,
  type CompanyOption,
} from "@/client/features/records/CompanyPicker";
import {
  RecordBulkBar,
  reportBulk,
  type RecordNoun,
} from "@/client/features/records/RecordBulkBar";
import {
  bulkArchiveContacts,
  bulkAssignContactOwner,
  bulkEnrichContacts,
  bulkPurgeContacts,
  bulkRestoreContacts,
  bulkSetContactCompany,
} from "@/serverFunctions/contacts";
import type { BulkResult } from "@/types/schemas/records";

const NOUN: RecordNoun = { one: "contact", many: "contacts" };

/** What the contacts list does to its selected rows. */
export function ContactBulkActions({
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
  const queryClient = useQueryClient();
  const [moving, setMoving] = useState(false);
  const settled = (done: (count: string) => string) => ({
    onSuccess: async (result: BulkResult) => {
      reportBulk(result, NOUN, done);
      onDone();
      await invalidateContacts(queryClient);
    },
  });

  const assign = useMutation({
    mutationFn: (input: { ids: string[]; ownerId: string | null }) =>
      bulkAssignContactOwner({ data: input }),
    ...settled((count) => `${count} reassigned.`),
  });
  const move = useMutation({
    mutationFn: (input: { ids: string[]; companyId: string | null }) =>
      bulkSetContactCompany({ data: input }),
    ...settled((count) => `${count} moved.`),
  });
  const enrich = useMutation({
    mutationFn: (selected: string[]) =>
      bulkEnrichContacts({ data: { ids: selected } }),
    ...settled(
      (count) =>
        `The agent is looking up ${count}. The list updates as it goes.`,
    ),
  });
  const archive = useMutation({
    mutationFn: (selected: string[]) =>
      bulkArchiveContacts({ data: { ids: selected } }),
    ...settled((count) => `${count} archived.`),
  });
  const restore = useMutation({
    mutationFn: (selected: string[]) =>
      bulkRestoreContacts({ data: { ids: selected } }),
    ...settled((count) => `${count} restored.`),
  });
  const purge = useMutation({
    mutationFn: (selected: string[]) =>
      bulkPurgeContacts({ data: { ids: selected } }),
    ...settled((count) => `${count} deleted forever.`),
  });
  const pending = [assign, move, enrich, archive, restore, purge].some(
    (mutation) => mutation.isPending,
  );

  return (
    <>
      <RecordBulkBar
        selectedCount={ids.length}
        noun={NOUN}
        archived={archived}
        canPurge={canPurge}
        pending={pending}
        onClear={onDone}
        onAssignOwner={(ownerId) => assign.mutate({ ids, ownerId })}
        onEnrich={() => enrich.mutate(ids)}
        onArchive={() => archive.mutate(ids)}
        onRestore={() => restore.mutate(ids)}
        onPurge={() => purge.mutate(ids)}
        actions={
          <TableBulkActionButton
            icon={<Building2 />}
            onClick={() => setMoving(true)}
            disabled={pending}
          >
            Move to company
          </TableBulkActionButton>
        }
      />
      {moving ? (
        <MoveContactsDialog
          count={ids.length}
          onClose={() => setMoving(false)}
          onMove={(companyId) => {
            setMoving(false);
            move.mutate({ ids, companyId });
          }}
        />
      ) : null}
    </>
  );
}

/** Picks the company the selected people move to, or none. */
function MoveContactsDialog({
  count,
  onClose,
  onMove,
}: {
  count: number;
  onClose: () => void;
  onMove: (companyId: string | null) => void;
}) {
  const id = useId();
  const [company, setCompany] = useState<CompanyOption | null>(null);
  const people = count === 1 ? "1 contact" : `${count} contacts`;
  return (
    <FormDialog
      title={`Move ${people}`}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onMove(company?.id ?? null)}>
            {company ? `Move to ${company.name}` : "Take off their company"}
          </Button>
        </>
      }
    >
      <Field>
        <FieldLabel htmlFor={id}>Company</FieldLabel>
        <CompanyPicker id={id} value={company} onChange={setCompany} />
        <FieldDescription>
          Leave it empty to take them off whatever company they are at.
        </FieldDescription>
      </Field>
    </FormDialog>
  );
}
