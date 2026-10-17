import { useMutation, useQueryClient } from "@tanstack/react-query";
import { revalidateLogic } from "@tanstack/react-form";
import { toast } from "sonner";
import { useAppForm } from "@/client/components/form/useAppForm";
import {
  SettingsCard,
  SettingsCardFooter,
} from "@/client/components/SettingsSection";
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

type Workspace = { name: string; website: string | null };

/** The workspace's name and website, saved; shared by both forms below. */
function useWorkspaceForm(initial: Workspace, onSaved?: () => void) {
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

  return useAppForm({
    defaultValues: {
      name: initial.name,
      website: initial.website ?? "",
    },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: updateWorkspaceSchema },
    onSubmit: async ({ value, formApi }) => {
      try {
        await mutation.mutateAsync(value);
        // The saved values are the new baseline, so Save disables again.
        formApi.reset(value);
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
}

/** Onboarding: the workspace's name and website, stacked. */
export function WorkspaceForm({
  initial,
  submitLabel,
  onSaved,
}: {
  initial: Workspace;
  submitLabel: string;
  onSaved?: () => void;
}) {
  const form = useWorkspaceForm(initial, onSaved);

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
              description="Read once, so every answer afterwards knows what you sell."
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

/** Settings → General: the same two fields as settings rows. */
export function WorkspaceSettingsCard({
  workspace,
  canManage,
}: {
  workspace: Workspace;
  canManage: boolean;
}) {
  const form = useWorkspaceForm(workspace, () =>
    toast.success("Workspace saved."),
  );

  return (
    <form.AppForm>
      <form.Form>
        <SettingsCard>
          <form.AppField name="name">
            {(field) => (
              <field.RowTextField
                label="Name"
                description="Shown wherever the CRM refers to your own company."
                placeholder="Acme Inc."
                autoComplete="organization"
                maxLength={WORKSPACE_NAME_MAX}
                disabled={!canManage}
                required
              />
            )}
          </form.AppField>
          <form.AppField name="website">
            {(field) => (
              <field.RowTextField
                label="Website"
                description="Your own company's website."
                prefix="https://"
                placeholder="acme.com"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                inputMode="url"
                disabled={!canManage}
                required
              />
            )}
          </form.AppField>
          <SettingsCardFooter
            note={
              canManage ? null : "Only an owner or an admin can change this."
            }
          >
            <form.Subscribe selector={(state) => state.isDefaultValue}>
              {(isDefaultValue) => (
                <form.SubmitButton disabled={!canManage || isDefaultValue}>
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
