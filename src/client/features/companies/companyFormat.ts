import type { getCompany, listCompanies } from "@/serverFunctions/companies";

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
