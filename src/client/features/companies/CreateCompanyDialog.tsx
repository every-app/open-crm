import { revalidateLogic } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { FormDialog } from "@/client/components/FormDialog";
import { useAppForm } from "@/client/components/form/useAppForm";
import { Button } from "@/client/components/ui/button";
import { companyErrorMessage } from "@/client/features/companies/useCompanyMutations";
import { useInvalidateRecords } from "@/client/features/records/recordQueries";
import {
  getErrorCode,
  getStandardErrorMessage,
} from "@/client/lib/error-messages";
import { createCompany } from "@/serverFunctions/companies";
import { COMPANY_NAME_MAX } from "@/types/schemas/companies";

const FORM_ID = "create-company";

const formSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "A company needs a name.")
    .max(COMPANY_NAME_MAX),
  domain: z.string().trim().max(255),
});

/** A name and optional website; the creator owns the new company. */
export function CreateCompanyDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (company: { id: string; name: string }) => void;
}) {
  const invalidate = useInvalidateRecords();
  const mutation = useMutation({
    mutationFn: (values: z.infer<typeof formSchema>) =>
      createCompany({
        data: {
          name: values.name,
          domain: values.domain || undefined,
        },
      }),
    // The form shows a taken or unreadable domain on the field itself.
    meta: { errorToast: false },
    onSuccess: async (company) => {
      toast.success(`${company.name} added.`);
      await invalidate();
      onCreated(company);
    },
  });

  const form = useAppForm({
    defaultValues: { name: "", domain: "" },
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
              fields: { domain: companyErrorMessage(error, "domain") },
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
        title="New company"
        onClose={onClose}
        actions={
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <form.SubmitButton form={FORM_ID}>Add company</form.SubmitButton>
          </>
        }
      >
        <form.Form id={FORM_ID} className="flex flex-col gap-4">
          <form.AppField name="name">
            {(field) => (
              <field.TextField
                label="Name"
                maxLength={COMPANY_NAME_MAX}
                autoComplete="off"
                autoFocus
                required
              />
            )}
          </form.AppField>
          <form.AppField name="domain">
            {(field) => (
              <field.TextField
                label="Website (optional)"
                placeholder="stripe.com"
                inputMode="url"
                autoComplete="off"
              />
            )}
          </form.AppField>
        </form.Form>
      </FormDialog>
    </form.AppForm>
  );
}
