import type { ReactNode } from "react";
import { revalidateLogic } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { everyAppAccountQueryOptions } from "@/client/components/Sidebar";
import { useAppForm } from "@/client/components/form/useAppForm";
import { Button } from "@/client/components/ui/button";
import { contactErrorMessage } from "@/client/features/contacts/useContactMutations";
import { parseAmount } from "@/client/features/deals/dealFormat";
import { useInvalidateRecords } from "@/client/features/records/recordQueries";
import {
  getErrorCode,
  getStandardErrorMessage,
} from "@/client/lib/error-messages";
import { createContact } from "@/serverFunctions/contacts";
import { createDeal } from "@/serverFunctions/deals";
import {
  CONTACT_EMAIL_MAX,
  CONTACT_NAME_MAX,
  CONTACT_TITLE_MAX,
} from "@/types/schemas/contacts";
import { DEAL_NAME_MAX } from "@/types/schemas/deals";

// A company's sheet adds a person who works there, or a deal sold to it,
// without leaving the sheet: a short form above the section's list. The new
// record belongs to whoever owns the company.

type QuickAddCompany = { id: string; name: string; ownerId: string | null };

/** The fields two by two, then Cancel and the submit. */
function QuickAddFrame({
  submit,
  onCancel,
  children,
}: {
  submit: ReactNode;
  onCancel: () => void;
  children: ReactNode;
}) {
  return (
    <div className="mb-3 space-y-3 rounded-lg border border-border p-3">
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        {submit}
      </div>
    </div>
  );
}

const contactSchema = z.object({
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
});

/** A person at the company: their name, email and title. */
export function QuickAddContact({
  company,
  onDone,
}: {
  company: QuickAddCompany;
  onDone: () => void;
}) {
  const invalidate = useInvalidateRecords();
  const create = useMutation({
    mutationFn: (values: z.infer<typeof contactSchema>) =>
      createContact({
        data: {
          firstName: values.firstName,
          lastName: values.lastName || undefined,
          email: values.email || undefined,
          title: values.title || undefined,
          companyId: company.id,
          ownerId: company.ownerId,
        },
      }),
    // A taken email shows on the field itself.
    meta: { errorToast: false },
    onSuccess: async (contact) => {
      await invalidate();
      toast.success(`${contact.firstName} added.`);
      onDone();
    },
  });

  const form = useAppForm({
    defaultValues: { firstName: "", lastName: "", email: "", title: "" },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: contactSchema },
    onSubmit: async ({ value, formApi }) => {
      try {
        await create.mutateAsync(value);
      } catch (error) {
        const code = getErrorCode(error);
        if (code === "CONFLICT" || code === "VALIDATION_ERROR") {
          formApi.setErrorMap({
            onSubmit: {
              fields: { email: contactErrorMessage(error, "email") },
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
      <form.Form>
        <QuickAddFrame
          onCancel={onDone}
          submit={<form.SubmitButton size="sm">Add contact</form.SubmitButton>}
        >
          <form.AppField name="firstName">
            {(field) => (
              <field.TextField
                label="First name"
                autoComplete="off"
                autoFocus
                maxLength={CONTACT_NAME_MAX}
              />
            )}
          </form.AppField>
          <form.AppField name="lastName">
            {(field) => (
              <field.TextField
                label="Last name"
                autoComplete="off"
                maxLength={CONTACT_NAME_MAX}
              />
            )}
          </form.AppField>
          <form.AppField name="email">
            {(field) => (
              <field.TextField
                label="Email"
                type="email"
                autoComplete="off"
                maxLength={CONTACT_EMAIL_MAX}
              />
            )}
          </form.AppField>
          <form.AppField name="title">
            {(field) => (
              <field.TextField
                label="Title"
                autoComplete="off"
                maxLength={CONTACT_TITLE_MAX}
              />
            )}
          </form.AppField>
        </QuickAddFrame>
      </form.Form>
    </form.AppForm>
  );
}

const dealSchema = z.object({
  name: z.string().trim().min(1, "A deal needs a name.").max(DEAL_NAME_MAX),
  amount: z
    .string()
    .refine(
      (value) => !value.trim() || parseAmount(value) !== null,
      "Enter an amount, like 24000.",
    ),
  expectedCloseDate: z.string(),
});

/**
 * A deal sold to the company: its name, what it's worth and when it should
 * close, in the workspace's reporting currency.
 */
export function QuickAddDeal({
  company,
  onDone,
}: {
  company: QuickAddCompany;
  onDone: () => void;
}) {
  const account = useQuery(everyAppAccountQueryOptions());
  const invalidate = useInvalidateRecords();
  const owner = company.ownerId ?? account.data?.userId ?? null;
  const create = useMutation({
    mutationFn: (values: z.infer<typeof dealSchema> & { ownerId: string }) =>
      createDeal({
        data: {
          name: values.name,
          companyId: company.id,
          ownerId: values.ownerId,
          amount: parseAmount(values.amount),
          expectedCloseDate: values.expectedCloseDate || null,
        },
      }),
    onSuccess: async (deal) => {
      await invalidate();
      toast.success(`${deal.name} created.`);
      onDone();
    },
  });

  const form = useAppForm({
    defaultValues: { name: "", amount: "", expectedCloseDate: "" },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: dealSchema },
    onSubmit: async ({ value }) => {
      if (!owner) {
        toast.error("Could not work out who should own this deal.");
        return;
      }
      await create.mutateAsync({ ...value, ownerId: owner });
    },
  });

  return (
    <form.AppForm>
      <form.Form>
        <QuickAddFrame
          onCancel={onDone}
          submit={<form.SubmitButton size="sm">Add deal</form.SubmitButton>}
        >
          <form.AppField name="name">
            {(field) => (
              <div className="sm:col-span-2">
                <field.TextField
                  label="Name"
                  autoComplete="off"
                  autoFocus
                  maxLength={DEAL_NAME_MAX}
                />
              </div>
            )}
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
          <form.AppField name="expectedCloseDate">
            {(field) => <field.TextField label="Close date" type="date" />}
          </form.AppField>
        </QuickAddFrame>
      </form.Form>
    </form.AppForm>
  );
}
