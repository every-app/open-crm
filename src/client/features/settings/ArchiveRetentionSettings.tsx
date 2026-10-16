import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { revalidateLogic } from "@tanstack/react-form";
import { toast } from "sonner";
import { SectionHeader } from "@/client/components/PageHeader";
import { QueryState } from "@/client/components/QueryState";
import { useAppForm } from "@/client/components/form/useAppForm";
import {
  archiveRetentionQueryOptions,
  useCanManageWorkspace,
} from "@/client/features/settings/settingsQueries";
import { setArchiveRetention } from "@/serverFunctions/settings";
import { archiveRetentionFormSchema } from "@/types/schemas/settings";

/**
 * Settings → Data: how long archived companies, contacts and deals are
 * kept before they are deleted for good.
 */
export function ArchiveRetentionSettings() {
  const canManage = useCanManageWorkspace();
  const query = useQuery(archiveRetentionQueryOptions());

  return (
    <section className="space-y-3">
      <SectionHeader
        title="Archived records"
        hint={
          canManage
            ? undefined
            : "Only an owner or an admin can change how long archives are kept."
        }
      />
      <p className="max-w-2xl text-sm text-muted-foreground">
        Archived companies, contacts and deals are hidden from lists, then
        deleted for good once they have been archived this long.
      </p>
      <QueryState
        query={query}
        errorFallback="The archive retention could not be loaded."
      >
        {({ days }) =>
          canManage ? (
            // Keyed by the saved value, so the form starts from it again.
            <RetentionForm key={days} days={days} />
          ) : (
            <p className="text-sm">
              Deleted {days.toLocaleString("en-US")}{" "}
              {days === 1 ? "day" : "days"} after they were archived.
            </p>
          )
        }
      </QueryState>
    </section>
  );
}

function RetentionForm({ days }: { days: number }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (next: number) => setArchiveRetention({ data: { days: next } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: archiveRetentionQueryOptions().queryKey,
      });
      toast.success("Archive retention saved");
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
      <form.Form className="flex max-w-56 flex-col gap-4">
        <form.AppField name="days">
          {(field) => (
            <field.TextField
              label="Delete archived records after"
              description="Days. 180 is the default."
              type="number"
              inputMode="numeric"
              min={1}
            />
          )}
        </form.AppField>
        <div>
          <form.Subscribe selector={(state) => state.values.days}>
            {(value) => (
              <form.SubmitButton disabled={value.trim() === String(days)}>
                Save
              </form.SubmitButton>
            )}
          </form.Subscribe>
        </div>
      </form.Form>
    </form.AppForm>
  );
}
