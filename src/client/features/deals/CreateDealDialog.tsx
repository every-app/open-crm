import { useId } from "react";
import { revalidateLogic } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { FormDialog } from "@/client/components/FormDialog";
import { everyAppAccountQueryOptions } from "@/client/components/Sidebar";
import { useAppForm } from "@/client/components/form/useAppForm";
import { Button } from "@/client/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/client/components/ui/field";
import { parseAmount } from "@/client/features/deals/dealFormat";
import {
  CompanyPicker,
  type CompanyOption,
} from "@/client/features/records/CompanyPicker";
import { useInvalidateRecords } from "@/client/features/records/recordQueries";
import {
  getErrorCode,
  getStandardErrorMessage,
} from "@/client/lib/error-messages";
import { getFieldError } from "@/client/lib/forms";
import { createDeal } from "@/serverFunctions/deals";
import { DEAL_NAME_MAX, type CreateDealInput } from "@/types/schemas/deals";

const FORM_ID = "create-deal";

const formSchema = z.object({
  name: z.string().trim().min(1, "A deal needs a name.").max(DEAL_NAME_MAX),
  company: z
    .custom<CompanyOption | null>()
    .refine((company) => Boolean(company), "Choose a company."),
  amount: z
    .string()
    .refine(
      (value) => !value.trim() || parseAmount(value) !== null,
      "Enter an amount, like 24000.",
    ),
});

type FormValues = z.input<typeof formSchema>;

/**
 * A new deal: what it's called, which company it's sold to and (if known)
 * what it's worth. It starts in the first stage, owned by whoever adds it,
 * in the workspace's reporting currency; those and its close date are set
 * on the deal, which opens next.
 */
export function CreateDealDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (deal: { id: string; name: string }) => void;
}) {
  const companyId = useId();
  const account = useQuery(everyAppAccountQueryOptions());
  const owner = account.data?.userId ?? null;
  const invalidate = useInvalidateRecords();
  const mutation = useMutation({
    mutationFn: (input: CreateDealInput) => createDeal({ data: input }),
    // The form shows a company that's gone on the field itself.
    meta: { errorToast: false },
    onSuccess: async (deal) => {
      toast.success(`${deal.name} added.`);
      await invalidate();
      onCreated(deal);
    },
  });

  const defaultValues: FormValues = { name: "", company: null, amount: "" };
  const form = useAppForm({
    defaultValues,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: formSchema },
    onSubmit: async ({ value, formApi }) => {
      if (!value.company) return;
      if (!owner) {
        toast.error("Could not work out who should own this deal.");
        return;
      }
      try {
        await mutation.mutateAsync({
          name: value.name,
          companyId: value.company.id,
          ownerId: owner,
          amount: parseAmount(value.amount),
        });
      } catch (error) {
        if (getErrorCode(error) === "NOT_FOUND") {
          formApi.setErrorMap({
            onSubmit: {
              fields: { company: "That company is gone. Pick another." },
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
        title="New deal"
        onClose={onClose}
        actions={
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <form.SubmitButton form={FORM_ID}>Add deal</form.SubmitButton>
          </>
        }
      >
        <form.Form id={FORM_ID} className="flex flex-col gap-4">
          <form.AppField name="name">
            {(field) => (
              <field.TextField
                label="Name"
                maxLength={DEAL_NAME_MAX}
                autoComplete="off"
                autoFocus
                required
              />
            )}
          </form.AppField>
          <form.AppField name="company">
            {(field) => {
              const error = getFieldError(field.state.meta.errors);
              return (
                <Field data-invalid={error ? true : undefined}>
                  <FieldLabel htmlFor={companyId}>Company</FieldLabel>
                  <CompanyPicker
                    id={companyId}
                    value={field.state.value}
                    onChange={(company) => field.handleChange(company)}
                  />
                  {error ? <FieldError>{error}</FieldError> : null}
                </Field>
              );
            }}
          </form.AppField>
          <form.AppField name="amount">
            {(field) => (
              <field.TextField
                label="Amount"
                placeholder="24000"
                inputMode="decimal"
                autoComplete="off"
              />
            )}
          </form.AppField>
        </form.Form>
      </FormDialog>
    </form.AppForm>
  );
}
