import { Plus, Star } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import {
  formatMoney,
  fullName,
  type Company,
} from "@/client/features/companies/companyFormat";
import {
  QuickAddContact,
  QuickAddDeal,
} from "@/client/features/companies/QuickAdd";
import type { useCompanyMutations } from "@/client/features/companies/useCompanyMutations";
import { DealStageMenu } from "@/client/features/deals/DealStage";
import { LocalDay } from "@/client/features/records/LocalDateTime";
import { RecordLink } from "@/client/features/records/RecordLink";
import { SheetSection } from "@/client/features/records/RecordSheet";
import { useQuickAdd } from "@/client/features/records/recordStack";
import {
  EmptyValue,
  PersonAvatar,
  SubListOwner,
} from "@/client/features/records/cells";

// Related contacts and deals, added without leaving the company details.

type Mutations = ReturnType<typeof useCompanyMutations>;

/** A section's "Add" button: in its header, or (outline) in its empty state. */
function AddButton({
  label,
  variant,
  onClick,
}: {
  label: string;
  variant: "ghost" | "outline";
  onClick: () => void;
}) {
  return (
    <Button
      variant={variant}
      size={variant === "ghost" ? "xs" : "sm"}
      onClick={onClick}
    >
      <Plus data-icon="inline-start" />
      {label}
    </Button>
  );
}

function quickAddCompany(company: Company) {
  return {
    id: company.id,
    name: company.name,
    ownerId: company.owner?.id ?? null,
  };
}

export function CompanyContacts({
  company,
  mutations,
}: {
  company: Company;
  mutations: Mutations;
}) {
  const { setPrimary } = mutations;
  const [add, setAdd] = useQuickAdd();
  const adding = add === "contact";
  const setAdding = (open: boolean) => setAdd(open ? "contact" : undefined);
  const empty = company.contacts.length === 0;
  return (
    <SheetSection
      title={`Contacts · ${company.contacts.length}`}
      action={
        adding ? null : (
          <AddButton
            label="Add contact"
            variant="ghost"
            onClick={() => setAdding(true)}
          />
        )
      }
    >
      {adding ? (
        <QuickAddContact
          company={quickAddCompany(company)}
          onDone={() => setAdding(false)}
        />
      ) : null}
      {empty ? null : (
        <ul className="-mx-2 divide-y divide-border">
          {company.contacts.map((contact) => {
            const name = fullName(contact);
            const primary = contact.id === company.primaryContactId;
            return (
              <li
                key={contact.id}
                className="flex min-w-0 items-center gap-2.5 px-2 py-2"
              >
                <PersonAvatar src={contact.imageUrl} name={name} size="sm" />
                <div className="min-w-0 flex-1">
                  <RecordLink
                    record={{ kind: "contact", id: contact.id }}
                    className="block text-sm font-medium"
                  >
                    {name}
                  </RecordLink>
                  <p className="truncate text-xs text-muted-foreground">
                    {[contact.title, contact.email].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <SubListOwner owner={contact.owner} />
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-pressed={primary}
                  aria-label={
                    primary
                      ? `${name} is the primary contact`
                      : `Make ${name} primary`
                  }
                  disabled={setPrimary.isPending}
                  onClick={() => setPrimary.mutate(primary ? null : contact.id)}
                >
                  <Star
                    className={
                      primary ? "fill-current text-warning" : undefined
                    }
                  />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </SheetSection>
  );
}

export function CompanyDeals({ company }: { company: Company }) {
  const [add, setAdd] = useQuickAdd();
  const adding = add === "deal";
  const setAdding = (open: boolean) => setAdd(open ? "deal" : undefined);
  const empty = company.deals.length === 0;
  return (
    <SheetSection
      title={`Deals · ${company.deals.length}`}
      action={
        adding ? null : (
          <AddButton
            label="New deal"
            variant="ghost"
            onClick={() => setAdding(true)}
          />
        )
      }
    >
      {adding ? (
        <QuickAddDeal
          company={quickAddCompany(company)}
          onDone={() => setAdding(false)}
        />
      ) : null}
      {empty ? null : (
        <ul className="-mx-2 divide-y divide-border">
          {company.deals.map((deal) => (
            <li
              key={deal.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-2 py-2 text-sm"
            >
              <div className="min-w-0">
                <RecordLink
                  record={{ kind: "deal", id: deal.id }}
                  className="block font-medium"
                >
                  {deal.name}
                </RecordLink>
                {deal.expectedCloseDate ? (
                  <p className="text-xs text-muted-foreground">
                    Closes <LocalDay date={deal.expectedCloseDate} />
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-right tabular-nums">
                  {deal.amount === null ? (
                    <EmptyValue />
                  ) : (
                    formatMoney(deal.amount, deal.currency)
                  )}
                </span>
                <DealStageMenu dealId={deal.id} stage={deal.stage} />
                <SubListOwner owner={deal.owner} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </SheetSection>
  );
}
