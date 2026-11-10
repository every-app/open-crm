import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { StageStepper } from "@/client/features/deals/DealStage";
import { CloseDate } from "@/client/features/deals/closeDate";
import {
  closeDay,
  formatAmount,
  parseAmount,
  type Deal,
} from "@/client/features/deals/dealFormat";
import type {
  DealPatch,
  useDealMutations,
} from "@/client/features/deals/useDealMutations";
import {
  DetailsActions,
  RecordFields,
} from "@/client/features/fields/RecordFields";
import { InlineCompanyField } from "@/client/features/records/CompanyPicker";
import {
  InlineField,
  InlineSelectField,
  InlineTextArea,
  PROPERTY_LABEL,
  PROPERTY_ROW,
} from "@/client/features/records/InlineField";
import {
  LocalDateTime,
  RelativeTime,
} from "@/client/features/records/LocalDateTime";
import { SheetSection } from "@/client/features/records/RecordSheet";
import { useOwnerOptions } from "@/client/features/records/owners";
import { CURRENCIES, normalizeCurrency } from "@/shared/currency";
import { isClosedStage } from "@/shared/deal-stages";
import { UNASSIGNED } from "@/types/schemas/records";

type Mutations = ReturnType<typeof useDealMutations>;

const CURRENCY_ITEMS = CURRENCIES.map((entry) => ({
  value: entry.code,
  label: `${entry.code} · ${entry.name}`,
}));

/** The supported currencies, and a deal's own when it's one no longer supported. */
function currencyItems(currency: string) {
  return CURRENCY_ITEMS.some((item) => item.value === currency)
    ? CURRENCY_ITEMS
    : [
        { value: currency, label: `${currency} (no longer supported)` },
        ...CURRENCY_ITEMS,
      ];
}

/** A deal's stage, details and description. */
export function DealOverview({
  deal,
  mutations,
}: {
  deal: Deal;
  mutations: Mutations;
}) {
  const [showEmpty, setShowEmpty] = useState(false);
  const { update } = mutations;
  // The fields whose save is in flight show a spinner.
  const saving =
    update.isPending && update.variables ? Object.keys(update.variables) : [];
  const save = (patch: DealPatch) => update.mutateAsync(patch);
  const currency = normalizeCurrency(deal.currency) || deal.currency;
  const open = !isClosedStage(deal.stage);

  return (
    <>
      <SheetSection title="Stage">
        <StageStepper dealId={deal.id} stage={deal.stage} />
        <dl className="mt-3 space-y-1 text-sm">
          <Property label="Opened">
            <LocalDateTime date={deal.createdAt} />
          </Property>
          {/* A closed deal's stage last changed as it closed. */}
          {open ? (
            <Property label="Stage changed">
              <RelativeTime date={deal.stageChangedAt} />
            </Property>
          ) : null}
          {deal.closedAt ? (
            <Property label="Closed">
              <LocalDateTime date={deal.closedAt} />
            </Property>
          ) : null}
          {deal.closedReason ? (
            <Property label="Reason">
              <span className="whitespace-pre-wrap">{deal.closedReason}</span>
            </Property>
          ) : null}
        </dl>
      </SheetSection>

      <SheetSection
        title="Details"
        action={
          // A deal's own properties always show: only a custom field can be
          // empty and out of sight.
          <DetailsActions
            entity="DEAL"
            recordId={deal.id}
            showEmpty={showEmpty}
            onShowEmpty={setShowEmpty}
          />
        }
      >
        <div className="space-y-0.5">
          <InlineField
            label="Name"
            value={deal.name}
            saving={saving.includes("name")}
            // A deal always has a name: an emptied one is put back.
            onSave={(name) => (name ? save({ name }) : null)}
          />
          <InlineField
            label="Amount"
            value={deal.amount === null ? null : String(deal.amount)}
            placeholder="24000"
            saving={saving.includes("amount")}
            format={(value) => {
              const amount = parseAmount(value);
              return amount === null ? value : formatAmount(amount, currency);
            }}
            onSave={(value) => {
              if (!value) return save({ amount: null });
              const amount = parseAmount(value);
              if (amount === null) {
                toast.error("Enter an amount, like 24000.");
                return Promise.reject(new Error("Not an amount."));
              }
              return save({ amount });
            }}
          />
          <InlineSelectField
            label="Currency"
            value={currency}
            items={currencyItems(currency)}
            saving={saving.includes("currency")}
            onSave={(next) => update.mutate({ currency: next })}
          />
          <ReportedValue deal={deal} currency={currency} />
          <InlineField
            label="Close date"
            type="date"
            value={closeDay(deal.expectedCloseDate)}
            saving={saving.includes("expectedCloseDate")}
            format={(day) => <CloseDate date={day} open={open} spelled />}
            onSave={(day) => save({ expectedCloseDate: day || null })}
          />
          <InlineCompanyField
            company={deal.company}
            saving={saving.includes("companyId")}
            // A deal always has a company: its menu has no "No company".
            onSave={(companyId) => {
              if (companyId) update.mutate({ companyId });
            }}
          />
          <OwnerField
            owner={deal.owner}
            saving={saving.includes("ownerId")}
            onSave={(ownerId) => update.mutate({ ownerId })}
          />
          <RecordFields
            entity="DEAL"
            recordId={deal.id}
            showEmpty={showEmpty}
          />
        </div>
      </SheetSection>

      <SheetSection title={deal.description ? "Description" : undefined}>
        <InlineTextArea
          label="Description"
          value={deal.description}
          saving={saving.includes("description")}
          onSave={(description) => save({ description })}
        />
      </SheetSection>
    </>
  );
}

function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={`${PROPERTY_ROW} items-center`}>
      <dt className={PROPERTY_LABEL}>{label}</dt>
      <dd className="min-w-0 px-2">{children}</dd>
    </div>
  );
}

/**
 * The amount in the reporting currency, frozen when it was saved, or why
 * it's left out of totals.
 */
function ReportedValue({ deal, currency }: { deal: Deal; currency: string }) {
  if (deal.amount === null || currency === deal.reportingCurrency) return null;
  const counted =
    deal.baseAmount !== null && deal.baseCurrency === deal.reportingCurrency;
  return (
    <div className={`${PROPERTY_ROW} min-h-8 items-center`}>
      <span className={PROPERTY_LABEL}>In {deal.reportingCurrency}</span>
      <span className="truncate px-2 text-sm text-muted-foreground">
        {counted && deal.baseAmount !== null ? (
          <span
            className="tabular-nums"
            title={
              deal.fxRate === null
                ? undefined
                : `1 ${currency} = ${deal.fxRate} ${deal.reportingCurrency}`
            }
          >
            ≈ {formatAmount(deal.baseAmount, deal.reportingCurrency)}
          </span>
        ) : (
          `No ${currency} rate, so it is left out of totals`
        )}
      </span>
    </div>
  );
}

/** The member who owns it: a deal always has one. */
function OwnerField({
  owner,
  saving,
  onSave,
}: {
  owner: Deal["owner"];
  saving: boolean;
  onSave: (ownerId: string) => void;
}) {
  const members = useOwnerOptions().filter(
    (option) => option.value !== UNASSIGNED,
  );
  // Someone who left still owns their deals until they're reassigned.
  const items = members.some((option) => option.value === owner.id)
    ? members
    : [...members, { value: owner.id, label: owner.name }];
  return (
    <InlineSelectField
      label="Owner"
      value={owner.id}
      items={items}
      saving={saving}
      onSave={onSave}
    />
  );
}
