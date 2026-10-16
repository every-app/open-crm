import type { getCompany, listCompanies } from "@/serverFunctions/companies";
import type { DealStage } from "@/shared/crm-enums";

export type Company = Awaited<ReturnType<typeof getCompany>>;
export type CompanyRow = Awaited<
  ReturnType<typeof listCompanies>
>["rows"][number];

/** "Berlin, BE, Germany", or null when nothing is known. */
export function location(company: {
  city: string | null;
  stateCode: string | null;
  country: string | null;
}): string | null {
  const parts = [company.city, company.stateCode, company.country].filter(
    Boolean,
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

export function fullName(person: {
  firstName: string;
  lastName: string | null;
}): string {
  return [person.firstName, person.lastName].filter(Boolean).join(" ");
}

/** "$24,000" in the reader's locale; whole units, as pipelines read. */
export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    // A currency code Intl doesn't know.
    return `${Math.round(amount).toLocaleString()} ${currency}`;
  }
}

// The deals feature owns the stages' labels; until it lands, the company
// sheet names them as the CRM does.
export const STAGE_LABELS: Record<DealStage, string> = {
  DEMO_BOOKED: "Demo booked",
  QUALIFIED_TO_BUY: "Qualified to buy",
  DECISION_MAKER_BOUGHT_IN: "Decision maker in",
  CONTRACT_SENT: "Contract sent",
  CLOSED_WON: "Closed won",
  CLOSED_LOST: "Closed lost",
  UNQUALIFIED_TO_BUY: "Unqualified",
};
