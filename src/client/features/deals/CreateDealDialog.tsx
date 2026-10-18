import { useId } from "react";
import { revalidateLogic } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { FormDialog } from "@/client/components/FormDialog";
import { SkeletonTableRows } from "@/client/components/SkeletonPresets";
import { everyAppAccountQueryOptions } from "@/client/components/Sidebar";
import { useAppForm } from "@/client/components/form/useAppForm";
import { Button } from "@/client/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/client/components/ui/field";
import { parseAmount } from "@/client/features/deals/dealFormat";
import { useInvalidateDeals } from "@/client/features/deals/useDealMutations";
import { membersQueryOptions } from "@/client/features/members/memberQueries";
import {
  CompanyPicker,
  type CompanyOption,
} from "@/client/features/records/CompanyPicker";
import { currencySettingsQueryOptions } from "@/client/features/settings/settingsQueries";
import {
  getErrorCode,
  getStandardErrorMessage,
} from "@/client/lib/error-messages";
import { getFieldError } from "@/client/lib/forms";
import { createDeal } from "@/serverFunctions/deals";
import { DEAL_STAGES } from "@/shared/crm-enums";
import {
  CURRENCY_CODES,
  DEFAULT_REPORTING_CURRENCY,
  type CurrencyCode,
} from "@/shared/currency";
import { DEAL_STAGE_LABELS, OPEN_DEAL_STAGES } from "@/shared/deal-stages";
import { DEAL_NAME_MAX, type CreateDealInput } from "@/types/schemas/deals";

const FORM_ID = "create-deal";

const formSchema = z.object({
  name: z.string().trim().min(1, "A deal needs a name.").max(DEAL_NAME_MAX),
  company: z
    .custom<CompanyOption | null>()
    .refine((company) => Boolean(company), "Choose a company."),
  owner: z.string().min(1, "A deal needs an owner."),
  stage: z.enum(DEAL_STAGES),
  amount: z
    .string()
    .refine(
      (value) => !value.trim() || parseAmount(value) !== null,
      "Enter an amount, like 24000.",
    ),
  currency: z.enum(CURRENCY_CODES),
  expectedCloseDate: z.string(),
});

type FormValues = z.input<typeof formSchema>;

const STAGE_ITEMS = OPEN_DEAL_STAGES.map((stage) => ({
  value: stage,
  label: DEAL_STAGE_LABELS[stage],
}));

const CURRENCY_ITEMS = CURRENCY_CODES.map((code) => ({
  value: code,
  label: code,
}));

/**
 * A new deal: what it's called, which company it's sold to, who owns it, and
 * (if known) what it's worth and when it should close. The owner starts as
 * you and the currency as the workspace's reporting currency.
 */
export function CreateDealDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (deal: { id: string; name: string }) => void;
}) {
  const account = useQuery(everyAppAccountQueryOptions());
  const currencies = useQuery(currencySettingsQueryOptions());
  const members = useQuery(membersQueryOptions());
  if (account.isPending || currencies.isPending || members.isPending) {
    return (
      <FormDialog title="New deal" onClose={onClose} actions={null}>
        <SkeletonTableRows rows={4} columns={1} />
      </FormDialog>
    );
  }
  return (
    <CreateDealForm
      owners={(members.data ?? []).map((member) => ({
        value: member.userId,
        label: member.name,
      }))}
      defaults={{
        owner: account.data?.userId ?? "",
        currency:
          currencies.data?.reportingCurrency ?? DEFAULT_REPORTING_CURRENCY,
      }}
      onClose={onClose}
      onCreated={onCreated}
    />
  );
}

function CreateDealForm({
  owners,
  defaults,
  onClose,
  onCreated,
}: {
  owners: { value: string; label: string }[];
  defaults: { owner: string; currency: CurrencyCode };
  onClose: () => void;
  onCreated: (deal: { id: string; name: string }) => void;
}) {
  const companyId = useId();
  const invalidate = useInvalidateDeals();
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

  const defaultValues: FormValues = {
    name: "",
    company: null,
    owner: defaults.owner,
    stage: "DEMO_BOOKED",
    amount: "",
    currency: defaults.currency,
    expectedCloseDate: "",
  };
  const form = useAppForm({
    defaultValues,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: formSchema },
    onSubmit: async ({ value, formApi }) => {
      if (!value.company) return;
      try {
        await mutation.mutateAsync({
          name: value.name,
          companyId: value.company.id,
          ownerId: value.owner,
          stage: value.stage,
          amount: parseAmount(value.amount),
          currency: value.currency,
          expectedCloseDate: value.expectedCloseDate || null,
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
          <form.AppField name="owner">
            {(field) => <field.SelectField label="Owner" items={owners} />}
          </form.AppField>
          <form.AppField name="stage">
            {(field) => <field.SelectField label="Stage" items={STAGE_ITEMS} />}
          </form.AppField>
          <div className="grid grid-cols-[minmax(0,1fr)_7rem] items-start gap-3">
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
            <form.AppField name="currency">
              {(field) => (
                <field.SelectField label="Currency" items={CURRENCY_ITEMS} />
              )}
            </form.AppField>
          </div>
          <form.AppField name="expectedCloseDate">
            {(field) => <field.TextField label="Close date" type="date" />}
          </form.AppField>
        </form.Form>
      </FormDialog>
    </form.AppForm>
  );
}
