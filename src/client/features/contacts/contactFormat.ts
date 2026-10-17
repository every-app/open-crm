import { fullName } from "@/client/features/companies/companyFormat";
import type { getContact, listContacts } from "@/serverFunctions/contacts";
import type { FactBand } from "@/shared/crm-enums";

export type Contact = Awaited<ReturnType<typeof getContact>>;
export type ContactRow = Awaited<
  ReturnType<typeof listContacts>
>["rows"][number];
export type ContactFact = Contact["facts"][number];

/** What each field the agent records facts about is called on the sheet. */
const FACT_LABELS: Record<string, string> = {
  name: "Name",
  title: "Title",
  linkedinUrl: "LinkedIn",
  twitterUrl: "X",
  githubUrl: "GitHub",
  employer: "Employer",
  seniority: "Seniority",
  function: "Function",
  location: "Location",
  tenure: "Tenure",
};

export function factLabel(field: string): string {
  return FACT_LABELS[field] ?? field;
}

/**
 * How strong the evidence behind a fact is. Verified needs a source that
 * identifies the person (their email on the profile, a reply on our own
 * thread); probable and possible are weaker, which is why a person decides.
 */
export const BAND_LABELS: Record<FactBand, string> = {
  VERIFIED: "Verified",
  PROBABLE: "Probable",
  POSSIBLE: "Possible",
};

/**
 * The newest applied fact of each field, and the newest proposal of each:
 * the sheet offers one suggestion a field at a time, and settling it brings
 * up the next.
 */
export function factsByField(facts: ContactFact[]) {
  const applied = new Map<string, ContactFact>();
  const proposed = new Map<string, ContactFact>();
  for (const fact of facts) {
    const bucket = fact.status === "APPLIED" ? applied : proposed;
    if (!bucket.has(fact.field)) bucket.set(fact.field, fact);
  }
  return { applied, proposed: [...proposed.values()] };
}

/** What the record says now for a field a suggestion would change. */
export function currentValue(contact: Contact, field: string): string | null {
  switch (field) {
    case "name":
      return fullName(contact);
    case "title":
    case "linkedinUrl":
    case "twitterUrl":
    case "githubUrl":
    case "seniority":
    case "function":
      return contact[field];
    case "employer":
      return contact.company?.name ?? null;
    case "location":
    case "tenure":
      return contact.brief?.sections[field] ?? null;
    default:
      return null;
  }
}

/** A value as a claim: case, scheme, "www." and a trailing slash aside. */
function canonical(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, "")
    .replace(/\/+$/, "");
}

/** Whether two values are the same claim, as an address or as text. */
export function sameValue(a: string, b: string): boolean {
  return canonical(a) === canonical(b);
}
