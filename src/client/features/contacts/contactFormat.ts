import type { getContact, listContacts } from "@/serverFunctions/contacts";
import type { FactBand } from "@/shared/crm-enums";

export type Contact = Awaited<ReturnType<typeof getContact>>;
export type ContactRow = Awaited<
  ReturnType<typeof listContacts>
>["rows"][number];
export type ContactFact = Contact["facts"][number];

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
 * the sheet offers one suggestion a field at a time, under the row it would
 * change, and settling it brings up the next.
 */
export function factsByField(facts: ContactFact[]) {
  const applied = new Map<string, ContactFact>();
  const proposed = new Map<string, ContactFact>();
  for (const fact of facts) {
    const bucket = fact.status === "APPLIED" ? applied : proposed;
    if (!bucket.has(fact.field)) bucket.set(fact.field, fact);
  }
  return { applied, proposed };
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
