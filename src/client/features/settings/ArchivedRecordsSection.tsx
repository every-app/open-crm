import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { revalidateLogic } from "@tanstack/react-form";
import { toast } from "sonner";
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
  const canManage = useCanManageWorkspace();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (next: number) => setArchiveRetention({ data: { days: next } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: archiveRetentionQueryOptions().queryKey,
      });
      toast.success("Archive retention saved.");
    },
  });

  const form = useAppForm({
    defaultValues: { days: String(days) },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: archiveRetentionFormSchema },
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync(Number(value.days));
    },
  });

  return (
    <form.AppForm>
      <form.Form>
        <SettingsCard>
          <form.AppField name="days">
            {(field) => (
              <field.RowTextField
                label="Prune archived records after"
                description="Days"
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
    </form.AppForm>
  );
}
