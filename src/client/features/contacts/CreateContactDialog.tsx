import { revalidateLogic } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { FormDialog } from "@/client/components/FormDialog";
import { useAppForm } from "@/client/components/form/useAppForm";
import { Button } from "@/client/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/client/components/ui/field";
import { fullName } from "@/client/features/companies/companyFormat";
import { contactErrorMessage } from "@/client/features/contacts/useContactMutations";
import {
  CompanyPicker,
  type CompanyOption,
} from "@/client/features/records/CompanyPicker";
import { ownerIdOf, useOwnerOptions } from "@/client/features/records/owners";
import { useInvalidateRecords } from "@/client/features/records/recordQueries";
import {
  getErrorCode,
  getStandardErrorMessage,
} from "@/client/lib/error-messages";
import { getFieldError } from "@/client/lib/forms";
import { createContact } from "@/serverFunctions/contacts";
import {
  CONTACT_EMAIL_MAX,
  CONTACT_NAME_MAX,
  CONTACT_TITLE_MAX,
} from "@/types/schemas/contacts";
import { UNASSIGNED } from "@/types/schemas/records";

const FORM_ID = "create-contact";

const formSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, "A contact needs a first name.")
    .max(CONTACT_NAME_MAX),
  lastName: z.string().trim().max(CONTACT_NAME_MAX),
  email: z
    .string()
    .trim()
    .max(CONTACT_EMAIL_MAX)
    .refine(
      (value) => value === "" || z.email().safeParse(value).success,
      "That is not an email address.",
    ),
  title: z.string().trim().max(CONTACT_TITLE_MAX),
  company: z.custom<CompanyOption>().nullable(),
  owner: z.string(),
});

type FormValues = z.infer<typeof formSchema>;

const defaultValues: FormValues = {
  firstName: "",
  lastName: "",
  email: "",
  title: "",
  company: null,
  owner: UNASSIGNED,
};

/** A person's name, email, title, company and owner; the agent finds the rest. */
export function CreateContactDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (contact: { id: string }) => void;
}) {
  const invalidate = useInvalidateRecords();
  const owners = useOwnerOptions();
  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      createContact({
        data: {
          firstName: values.firstName,
          lastName: values.lastName || undefined,
          email: values.email || undefined,
          title: values.title || undefined,
          companyId: values.company?.id ?? null,
          ownerId: ownerIdOf(values.owner),
        },
      }),
    // The form shows a taken email or a gone company on the field itself.
    meta: { errorToast: false },
    onSuccess: async (contact) => {
      toast.success(`${fullName(contact)} added.`);
      await invalidate();
      onCreated(contact);
    },
  });

  const form = useAppForm({
    defaultValues,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: formSchema },
    onSubmit: async ({ value, formApi }) => {
      try {
        await mutation.mutateAsync(value);
      } catch (error) {
        const code = getErrorCode(error);
        if (code === "CONFLICT" || code === "VALIDATION_ERROR") {
          formApi.setErrorMap({
            onSubmit: {
              fields: { email: contactErrorMessage(error, "email") },
            },
          });
        } else if (code === "NOT_FOUND") {
          formApi.setErrorMap({
            onSubmit: {
              fields: {
                company: "That company is gone. Pick another.",
              },
            },
          });
        } else {
          toast.error(getStandardErrorMessage(error));
        }
      }
    },
  });

  return (
    <form.AppForm>
      <FormDialog
        title="New contact"
        onClose={onClose}
        actions={
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <form.SubmitButton form={FORM_ID}>Add contact</form.SubmitButton>
          </>
        }
      >
        <form.Form id={FORM_ID} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <form.AppField name="firstName">
              {(field) => (
                <field.TextField
                  label="First name"
                  maxLength={CONTACT_NAME_MAX}
                  autoComplete="off"
                  autoFocus
                  required
                />
              )}
            </form.AppField>
            <form.AppField name="lastName">
              {(field) => (
                <field.TextField
                  label="Last name"
                  maxLength={CONTACT_NAME_MAX}
                  autoComplete="off"
                />
              )}
            </form.AppField>
          </div>
          <form.AppField name="email">
            {(field) => (
              <field.TextField
                label="Email"
                type="email"
                maxLength={CONTACT_EMAIL_MAX}
                autoComplete="off"
              />
            )}
          </form.AppField>
          <form.AppField name="title">
            {(field) => (
              <field.TextField
                label="Title"
                maxLength={CONTACT_TITLE_MAX}
                autoComplete="off"
              />
            )}
          </form.AppField>
          <form.AppField name="company">
            {(field) => {
              const error = getFieldError(field.state.meta.errors);
              return (
                <Field data-invalid={error ? true : undefined}>
                  <FieldLabel htmlFor={`${FORM_ID}-company`}>
                    Company
                  </FieldLabel>
                  <CompanyPicker
                    id={`${FORM_ID}-company`}
                    value={field.state.value}
                    onChange={(company) => field.handleChange(company)}
                  />
                  {error ? <FieldError>{error}</FieldError> : null}
                </Field>
              );
            }}
          </form.AppField>
          <form.AppField name="owner">
            {(field) => <field.SelectField label="Owner" items={owners} />}
          </form.AppField>
        </form.Form>
      </FormDialog>
    </form.AppForm>
  );
}
