import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { revalidateLogic } from "@tanstack/react-form";
import { toast } from "sonner";
import { useId, useState } from "react";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { QueryError } from "@/client/components/QueryState";
import { SettingsRow } from "@/client/components/SettingsSection";
import { useAppForm } from "@/client/components/form/useAppForm";
import { FieldError } from "@/client/components/ui/field";
import { Input } from "@/client/components/ui/input";
import { Skeleton } from "@/client/components/ui/skeleton";
import {
  archiveRetentionQueryOptions,
  useCanManageWorkspace,
} from "@/client/features/settings/settingsQueries";
import { getFieldError } from "@/client/lib/forms";
import { setArchiveRetention } from "@/serverFunctions/settings";
import { archiveRetentionFormSchema } from "@/types/schemas/settings";

const LABEL = "Delete archived records after";

/**
 * Settings → Workspace → Data: how long archived companies, contacts and
 * deals are kept before they are pruned for good. One row with its own Save.
 */
export function ArchiveRetentionRow() {
  const query = useQuery(archiveRetentionQueryOptions());

  if (query.data === undefined) {
    return (
      <SettingsRow label={LABEL}>
        {query.isError ? (
          <QueryError
            error={query.error}
            fallback="The archive retention could not be loaded."
            onRetry={() => void query.refetch()}
            isRetrying={query.isFetching}
            variant="inline"
          />
        ) : (
          <Skeleton className="h-10 w-40" />
        )}
      </SettingsRow>
    );
  }
  // Keyed by the saved value, so the form starts from it again.
  return <RetentionForm key={query.data.days} days={query.data.days} />;
}

function RetentionForm({ days }: { days: number }) {
  const id = useId();
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
        <form.AppField name="days">
          {(field) => {
            const error = getFieldError(field.state.meta.errors);
            return (
              <SettingsRow
                label={LABEL}
                htmlFor={id}
                description={
                  <>
                    <span id={`${id}-description`}>
                      Deleting a company also removes its deals and their
                      history.
                    </span>
                    {error ? (
                      <FieldError id={`${id}-error`}>{error}</FieldError>
                    ) : null}
                  </>
                }
              >
                <Input
                  id={id}
                  name={field.name}
                  className="w-20"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  disabled={!canManage}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={`${id}-description${error ? ` ${id}-error` : ""}`}
                />
                <span className="text-sm text-muted-foreground">days</span>
                {canManage ? (
                  <form.SubmitButton
                    variant="outline"
                    disabled={field.state.value.trim() === String(days)}
                  >
                    Save
                  </form.SubmitButton>
                ) : null}
              </SettingsRow>
            );
          }}
        </form.AppField>
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
