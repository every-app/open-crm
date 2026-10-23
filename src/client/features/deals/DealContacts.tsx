import { useId } from "react";
import { revalidateLogic } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { useAppForm } from "@/client/components/form/useAppForm";
import { Button } from "@/client/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/client/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { fullName } from "@/client/features/companies/companyFormat";
import type { Deal } from "@/client/features/deals/dealFormat";
import { dealContactOptionsQueryOptions } from "@/client/features/deals/dealQueries";
import type { useDealMutations } from "@/client/features/deals/useDealMutations";
import { InlineField } from "@/client/features/records/InlineField";
import { RecordLink } from "@/client/features/records/RecordLink";
import { useQuickAdd } from "@/client/features/records/recordStack";
import { SheetSection } from "@/client/features/records/RecordSheet";
import { PersonAvatar } from "@/client/features/records/cells";
import { getFieldError } from "@/client/lib/forms";

type Mutations = ReturnType<typeof useDealMutations>;

/**
 * A deal's Contacts tab: the people from its company who are on it, and
 * their roles. The tab names the list and counts it.
 */
export function DealContacts({
  deal,
  mutations,
}: {
  deal: Deal;
  mutations: Mutations;
}) {
  // In the URL, as the CRM had it: a refresh or a link brings the form back.
  const [add, setAdd] = useQuickAdd();
  const adding = add === "contact";
  const setAdding = (open: boolean) => setAdd(open ? "contact" : undefined);
  const { detachContact, setContactRole } = mutations;

  return (
    <SheetSection
      title={`Contacts · ${deal.contacts.length}`}
      action={
        adding ? null : (
          <Button variant="ghost" size="xs" onClick={() => setAdding(true)}>
            <Plus data-icon="inline-start" />
            Add contact
          </Button>
        )
      }
    >
      {adding ? (
        <AddDealContact
          deal={deal}
          mutations={mutations}
          onDone={() => setAdding(false)}
        />
      ) : null}
      {deal.contacts.length === 0 ? null : (
        <ul className="-mx-2 divide-y divide-border">
          {deal.contacts.map((contact) => {
            const name = fullName(contact);
            return (
              <li
                key={contact.id}
                className="flex min-w-0 items-start gap-2.5 px-2 py-2"
              >
                <PersonAvatar src={contact.imageUrl} name={name} size="sm" />
                <div className="min-w-0 flex-1 space-y-1">
                  <RecordLink
                    record={{ kind: "contact", id: contact.id }}
                    className="block text-sm font-medium"
                  >
                    {name}
                  </RecordLink>
                  {contact.title || contact.email ? (
                    <p className="truncate text-xs text-muted-foreground">
                      {[contact.title, contact.email]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  ) : null}
                  <InlineField
                    label="Role"
                    value={contact.role}
                    saving={
                      setContactRole.isPending &&
                      setContactRole.variables?.contactId === contact.id
                    }
                    onSave={(role) =>
                      setContactRole.mutate({
                        contactId: contact.id,
                        role: role || null,
                      })
                    }
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Take ${name} off this deal`}
                  disabled={detachContact.isPending}
                  onClick={() => detachContact.mutate(contact.id)}
                >
                  <X />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </SheetSection>
  );
}

const addSchema = z.object({
  contactId: z.string().min(1, "Choose somebody."),
  role: z.string().trim().max(80, "That role is too long."),
});

/** Someone from the deal's company who isn't on it yet, and their role. */
function AddDealContact({
  deal,
  mutations,
  onDone,
}: {
  deal: Deal;
  mutations: Mutations;
  onDone: () => void;
}) {
  const personId = useId();
  const options = useQuery(dealContactOptionsQueryOptions(deal.id));
  const candidates = options.data ?? [];
  const items = candidates.map((candidate) => ({
    value: candidate.id,
    label: candidate.title
      ? `${fullName(candidate)} · ${candidate.title}`
      : fullName(candidate),
  }));
  const nobody = !options.isPending && candidates.length === 0;

  const form = useAppForm({
    defaultValues: { contactId: "", role: "" },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: addSchema },
    onSubmit: async ({ value }) => {
      await mutations.attachContact.mutateAsync({
        contactId: value.contactId,
        role: value.role.trim() || null,
      });
      const person = candidates.find(
        (candidate) => candidate.id === value.contactId,
      );
      toast.success(
        person ? `${fullName(person)} is on the deal.` : "Added to the deal.",
      );
      onDone();
    },
  });

  return (
    <form.AppForm>
      <form.Form className="mb-3 flex flex-col gap-3 rounded-lg border border-border p-3">
        <form.AppField name="contactId">
          {(field) => {
            const error = getFieldError(field.state.meta.errors);
            return (
              <Field data-invalid={error ? true : undefined}>
                <FieldLabel htmlFor={personId}>Person</FieldLabel>
                <Select
                  items={items}
                  value={field.state.value || null}
                  onValueChange={(next) => {
                    if (typeof next === "string") field.handleChange(next);
                  }}
                  disabled={nobody}
                >
                  <SelectTrigger
                    id={personId}
                    className="w-full"
                    aria-invalid={error ? true : undefined}
                  >
                    <SelectValue
                      placeholder={
                        options.isPending
                          ? "Loading…"
                          : nobody
                            ? `Everybody at ${deal.company.name} is already on it`
                            : "Choose somebody"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {items.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {error ? <FieldError>{error}</FieldError> : null}
              </Field>
            );
          }}
        </form.AppField>
        <form.AppField name="role">
          {(field) => (
            <field.TextField label="Role" autoComplete="off" maxLength={80} />
          )}
        </form.AppField>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onDone}>
            Cancel
          </Button>
          <form.SubmitButton size="sm" disabled={nobody}>
            Add to deal
          </form.SubmitButton>
        </div>
      </form.Form>
    </form.AppForm>
  );
}
