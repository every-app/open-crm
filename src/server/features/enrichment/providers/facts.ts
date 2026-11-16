// What a lookup brings back, in the CRM's own columns, whichever provider
// answered. Every value is a candidate for a blank: the repository writes one
// only where the record still has none.

export const PERSON_FACT_FIELDS = [
  "title",
  "linkedinUrl",
  "twitterUrl",
  "githubUrl",
  "imageUrl",
] as const;
export type PersonFactField = (typeof PERSON_FACT_FIELDS)[number];
export type PersonFacts = Partial<Record<PersonFactField, string>>;

export const COMPANY_FACT_FIELDS = [
  "name",
  "description",
  "logoUrl",
  "logoDarkUrl",
  "iconUrl",
  "iconDarkUrl",
  "iconTone",
  "brandColor",
  "industry",
  "subIndustry",
  "city",
  "stateCode",
  "country",
  "countryCode",
  "phone",
  "email",
  "linkedinUrl",
  "twitterUrl",
  "githubUrl",
  "pricingUrl",
  "careersUrl",
] as const;
export type CompanyFactField = (typeof COMPANY_FACT_FIELDS)[number];
export type CompanyFacts = Partial<Record<CompanyFactField, string>>;

/** The picture columns, copied into the CRM's own storage before they are written. */
export const COMPANY_IMAGE_FIELDS = [
  "logoUrl",
  "logoDarkUrl",
  "iconUrl",
  "iconDarkUrl",
] as const satisfies readonly CompanyFactField[];

/** What the CRM knows of a contact, to look them up by. */
export type PersonClues = {
  email: string | null;
  firstName: string;
  lastName: string | null;
  linkedinUrl: string | null;
  companyName: string | null;
  companyDomain: string | null;
};

/** What the CRM knows of a company, to look it up by. */
export type CompanyClues = {
  name: string;
  domain: string | null;
  linkedinUrl: string | null;
};

/**
 * `found`: the provider knew them. `skipped`: nothing to look up by, or no
 * match. `failed`: the lookup itself failed. Reasons are written for the
 * member who asked.
 */
export type Lookup<Facts> =
  | { outcome: "found"; facts: Facts }
  | { outcome: "skipped"; reason: string }
  | { outcome: "failed"; reason: string };

/**
 * The handle of a personal LinkedIn profile URL, or null. One typed without
 * its scheme ("linkedin.com/in/jane") is the same profile.
 */
export function linkedinHandle(raw: string | null): string | null {
  const typed = raw?.trim();
  if (!typed) return null;
  try {
    const url = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`,
    );
    const host = url.hostname.toLowerCase();
    if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return null;
    const [section, handle] = url.pathname.split("/").filter(Boolean);
    if (section !== "in" || !handle) return null;
    return decodeURIComponent(handle);
  } catch {
    return null;
  }
}

/** The profile URL for a LinkedIn handle, as a provider is asked for it. */
export function linkedinProfileUrl(handle: string): string {
  return `https://www.linkedin.com/in/${encodeURIComponent(handle.trim())}`;
}

/** The first of `urls` on one of `hosts` (or a subdomain), or undefined. */
export function urlOnHost(
  urls: readonly (string | null | undefined)[],
  hosts: readonly string[],
): string | undefined {
  for (const raw of urls) {
    if (!raw) continue;
    try {
      const host = new URL(raw).hostname.toLowerCase();
      if (
        hosts.some((wanted) => host === wanted || host.endsWith(`.${wanted}`))
      )
        return raw;
    } catch {
      // Not a URL: not a profile.
    }
  }
  return undefined;
}
