import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { revalidateLogic } from "@tanstack/react-form";
import { toast } from "sonner";
import { useState } from "react";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { QueryState } from "@/client/components/QueryState";
import {
  SettingsCard,
  SettingsCardFooter,
  SettingsSection,
} from "@/client/components/SettingsSection";
import { useAppForm } from "@/client/components/form/useAppForm";
import {
  archiveRetentionQueryOptions,
  useCanManageWorkspace,
} from "@/client/features/settings/settingsQueries";
import { setArchiveRetention } from "@/serverFunctions/settings";
import { archiveRetentionFormSchema } from "@/types/schemas/settings";

/**
 * Settings → General: how long archived companies, contacts and deals are
 * kept before they are pruned for good.
 */
export function ArchivedRecordsSection() {
  const query = useQuery(archiveRetentionQueryOptions());

  return (
    <SettingsSection title="Archived records">
      <QueryState
        query={query}
        errorFallback="The archive retention could not be loaded."
      >
        {/* Keyed by the saved value, so the form starts from it again. */}
        {({ days }) => <RetentionForm key={days} days={days} />}
      </QueryState>
    </SettingsSection>
  );
}

function RetentionForm({ days }: { days: number }) {
  const [confirmDays, setConfirmDays] = useState<number | null>(null);
  const canManage = useCanManageWorkspace();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (next: number) => setArchiveRetention({ data: { days: next } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: archiveRetentionQueryOptions().queryKey,
      });
      toast.success("Archive retention saved.");
      setConfirmDays(null);
    },
  });

  const form = useAppForm({
    defaultValues: { days: String(days) },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: archiveRetentionFormSchema },
    onSubmit: async ({ value }) => {
      const next = Number(value.days);
      if (next < days) setConfirmDays(next);
      else await mutation.mutateAsync(next);
    },
  });

  return (
    <form.AppForm>
      <form.Form>
        <SettingsCard>
          <form.AppField name="days">
            {(field) => (
              <field.RowTextField
                label="Permanently delete archived records after"
                description="Days. Deleting a company also removes its deals and their history."
                className="sm:w-28"
                type="number"
                inputMode="numeric"
                min={1}
                disabled={!canManage}
              />
            )}
          </form.AppField>
          <SettingsCardFooter
            note={
              canManage ? null : "Only an owner or an admin can change this."
            }
          >
            <form.Subscribe selector={(state) => state.values.days}>
              {(value) => (
                <form.SubmitButton
                  disabled={!canManage || value.trim() === String(days)}
                >
                  Save
                </form.SubmitButton>
              )}
            </form.Subscribe>
          </SettingsCardFooter>
        </SettingsCard>
      </form.Form>
      {confirmDays !== null ? (
        <ConfirmDialog
          title={`Delete archived records after ${confirmDays} days?`}
          confirmLabel="Shorten retention"
          destructive
          pending={mutation.isPending}
          onClose={() => setConfirmDays(null)}
          onConfirm={() => mutation.mutate(confirmDays)}
        >
          Archived records older than {confirmDays} days will be permanently
          deleted at the next cleanup, including a deleted company's deals and
          history.
        </ConfirmDialog>
      ) : null}
    </form.AppForm>
  );
}
