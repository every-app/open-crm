import { useMutation, useQueryClient } from "@tanstack/react-query";
import { revalidateLogic } from "@tanstack/react-form";
import { toast } from "sonner";
import { useAppForm } from "@/client/components/form/useAppForm";
import {
  getErrorCode,
  getStandardErrorMessage,
} from "@/client/lib/error-messages";
import { workspaceQueryOptions } from "@/client/features/workspace/workspaceQueries";
import { updateWorkspace } from "@/serverFunctions/workspace";
import {
  WORKSPACE_NAME_MAX,
  updateWorkspaceSchema,
} from "@/types/schemas/workspace";

// The server sends only the error code, so the field message lives here.
const SERVER_FIELD_ERRORS: Record<string, Record<string, string>> = {
  VALIDATION_ERROR: {
    website: "That is not a website. Enter the domain, like acme.com.",
  },
};

/** The workspace's name and website: onboarding and Settings → Workspace. */
export function WorkspaceForm({
  initial,
  submitLabel,
  onSaved,
}: {
  initial: { name: string; website: string | null };
  submitLabel: string;
  onSaved?: () => void;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (values: { name: string; website: string }) =>
      updateWorkspace({ data: values }),
    // The form shows field errors inline and toasts the rest itself.
    meta: { errorToast: false },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: workspaceQueryOptions().queryKey,
      });
      onSaved?.();
    },
  });

  const form = useAppForm({
    defaultValues: {
      name: initial.name,
      website: initial.website ?? "",
    },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: updateWorkspaceSchema },
    onSubmit: async ({ value, formApi }) => {
      try {
        await mutation.mutateAsync(value);
      } catch (error) {
        const fields = SERVER_FIELD_ERRORS[getErrorCode(error) ?? ""];
        if (fields) {
          formApi.setErrorMap({ onSubmit: { fields } });
        } else {
          toast.error(getStandardErrorMessage(error));
        }
      }
    },
  });

  return (
    <form.AppForm>
      <form.Form className="flex max-w-md flex-col gap-4">
        <form.AppField name="name">
          {(field) => (
            <field.TextField
              label="Company name"
              placeholder="Acme Inc."
              maxLength={WORKSPACE_NAME_MAX}
              required
            />
          )}
        </form.AppField>
        <form.AppField name="website">
          {(field) => (
            <field.TextField
              label="Website"
              description="The agent reads it to learn what your company sells and who it sells to."
              placeholder="acme.com"
              required
            />
          )}
        </form.AppField>
        <div>
          <form.SubmitButton>{submitLabel}</form.SubmitButton>
        </div>
      </form.Form>
    </form.AppForm>
  );
}
