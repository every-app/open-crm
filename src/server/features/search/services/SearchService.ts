import { SearchRepository } from "@/server/features/search/repositories/SearchRepository";
import type { RecordKind } from "@/shared/records";
import { QUICK_SEARCH_MIN_LENGTH } from "@/types/schemas/search";

// The quick switcher (⌘K): jump to a company, contact or deal by typing part
// of its name. Archived records stay out, as they stay out of every list.

/** Matches of each kind, at most. */
const PER_KIND = 5;

type SearchHit = {
  kind: RecordKind;
  id: string;
  label: string;
  /** A company's domain, a contact's company (or email), a deal's company. */
  detail: string | null;
  iconUrl: string | null;
  iconDarkUrl: string | null;
  iconTone: string | null;
  imageUrl: string | null;
};

async function quick(
  organizationId: string,
  q: string,
): Promise<{ hits: SearchHit[] }> {
  const term = q.trim();
  if (term.length < QUICK_SEARCH_MIN_LENGTH) return { hits: [] };
  const [companies, contacts, deals] = await Promise.all([
    SearchRepository.companies(organizationId, term, PER_KIND),
    SearchRepository.contacts(organizationId, term, PER_KIND),
    SearchRepository.deals(organizationId, term, PER_KIND),
  ]);
  return {
    hits: [
      ...companies.map(
        (company): SearchHit => ({
          kind: "company",
          id: company.id,
          label: company.name,
          detail: company.domain,
          iconUrl: company.iconUrl,
          iconDarkUrl: company.iconDarkUrl,
          iconTone: company.iconTone,
          imageUrl: null,
        }),
      ),
      ...contacts.map(
        (contact): SearchHit => ({
          kind: "contact",
          id: contact.id,
          label:
            [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
            (contact.email ?? "Unnamed"),
          detail: contact.companyName ?? contact.email,
          iconUrl: null,
          iconDarkUrl: null,
          iconTone: null,
          imageUrl: contact.imageUrl,
        }),
      ),
      ...deals.map(
        (deal): SearchHit => ({
          kind: "deal",
          id: deal.id,
          label: deal.name,
          detail: deal.companyName,
          iconUrl: deal.iconUrl,
          iconDarkUrl: deal.iconDarkUrl,
          iconTone: deal.iconTone,
          imageUrl: null,
        }),
      ),
    ],
  };
}

export const SearchService = {
  quick,
};
