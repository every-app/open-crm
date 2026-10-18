import { formatMoney } from "@/client/features/companies/companyFormat";
import type { Contact } from "@/client/features/contacts/contactFormat";
import { DealStageMenu } from "@/client/features/deals/DealStage";
import { LocalDay } from "@/client/features/records/LocalDateTime";
import { RecordLink } from "@/client/features/records/RecordLink";
import {
  SheetEmpty,
  SheetSection,
} from "@/client/features/records/RecordSheet";
import { EmptyValue, SubListOwner } from "@/client/features/records/cells";

/**
 * A contact's Deals tab: the deals they're on, with their role on each. A
 * deal is opened on the company, and people are added to it there.
 */
export function ContactDeals({ contact }: { contact: Contact }) {
  return (
    <SheetSection>
      {contact.deals.length === 0 ? (
        <SheetEmpty title="Not on any deals" />
      ) : (
        <ul className="-mx-2 divide-y divide-border">
          {contact.deals.map((deal) => (
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
                {deal.role || deal.expectedCloseDate ? (
                  <p className="truncate text-xs text-muted-foreground">
                    {deal.role}
                    {deal.role && deal.expectedCloseDate ? " · " : null}
                    {deal.expectedCloseDate ? (
                      <>
                        Closes <LocalDay date={deal.expectedCloseDate} />
                      </>
                    ) : null}
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
