import { unique } from "remeda";
import { ActivityRepository } from "@/server/features/activities/repositories/ActivityRepository";
import { WorkspaceRepository } from "@/server/features/workspace/repositories/WorkspaceRepository";
import { UserFacingError, loggableError } from "@/server/lib/errors";
import { storeImage } from "@/server/lib/images";
import {
  ENRICHMENT_PROVIDERS,
  ENRICHMENT_PROVIDER_NAMES,
  type EnrichmentKind,
  type EnrichmentProvider,
  type EnrichmentRecordResult,
  type EnrichmentRunResult,
  type EnrichmentSettings,
} from "@/shared/enrichment";
import { ContextProvider } from "../providers/context";
import {
  COMPANY_IMAGE_FIELDS,
  type CompanyFactField,
  type Lookup,
  type PersonFactField,
} from "../providers/facts";
import {
  providerFetch,
  providerStatus,
  type ProviderFetch,
} from "../providers/gateway";
import { TregProvider } from "../providers/treg";
import { EnrichmentRepository } from "../repositories/EnrichmentRepository";

// Enrichment, when a member asks for it: the contacts or companies they
// selected are looked up with the workspace's provider for that kind, and
// what comes back fills the records' blanks. Nothing runs on its own: no
// queue, no cron, no lookup for a record nobody selected.

const PROVIDERS = { context: ContextProvider, treg: TregProvider };

const PREFERENCE = {
  contact: "contactEnrichmentProvider",
  company: "companyEnrichmentProvider",
} as const satisfies Record<EnrichmentKind, string>;

/** A filled field as the timeline names it; null for one not worth naming. */
const PERSON_LABELS: Record<PersonFactField, string> = {
  title: "title",
  linkedinUrl: "LinkedIn",
  twitterUrl: "X",
  githubUrl: "GitHub",
  imageUrl: "photo",
};

const COMPANY_LABELS: Record<CompanyFactField, string | null> = {
  name: "name",
  description: "description",
  logoUrl: "logo",
  logoDarkUrl: "logo",
  iconUrl: "icon",
  iconDarkUrl: "icon",
  iconTone: null,
  brandColor: "brand color",
  industry: "industry",
  subIndustry: "industry",
  city: "location",
  stateCode: "location",
  country: "location",
  countryCode: "location",
  phone: "phone",
  email: "email",
  linkedinUrl: "LinkedIn",
  twitterUrl: "X",
  githubUrl: "GitHub",
  pricingUrl: "pricing page",
  careersUrl: "careers page",
};

type Caller = { organizationId: string; userId: string };

/** The providers' state and the workspace's choice for each kind of record. */
async function getSettings(
  organizationId: string,
): Promise<EnrichmentSettings> {
  const [providers, workspace] = await Promise.all([
    Promise.all(ENRICHMENT_PROVIDERS.map(providerStatus)),
    WorkspaceRepository.getOrCreate(organizationId),
  ]);
  const ready = providers
    .filter((status) => status.ready)
    .map((status) => status.provider);
  const active = (preferred: EnrichmentProvider | null) =>
    preferred && ready.includes(preferred) ? preferred : (ready[0] ?? null);
  const preferred = {
    contact: workspace.contactEnrichmentProvider,
    company: workspace.companyEnrichmentProvider,
  };
  return {
    providers,
    preferred,
    active: {
      contact: active(preferred.contact),
      company: active(preferred.company),
    },
  };
}

/** The provider a kind of record is enriched with from now on. */
async function setPreferred(
  organizationId: string,
  kind: EnrichmentKind,
  provider: EnrichmentProvider,
): Promise<EnrichmentSettings> {
  await WorkspaceRepository.update(organizationId, {
    [PREFERENCE[kind]]: provider,
  });
  return getSettings(organizationId);
}

/** The provider a run uses now and its fetch, or a refusal that says who sets one up. */
async function providerFor(
  organizationId: string,
  kind: EnrichmentKind,
): Promise<{ provider: EnrichmentProvider; fetcher: ProviderFetch }> {
  const provider = (await getSettings(organizationId)).active[kind];
  const fetcher = provider ? await providerFetch(provider) : null;
  if (!provider || !fetcher) {
    throw new UserFacingError(
      "INTEGRATION_UNAVAILABLE",
      "No enrichment provider is set up. An owner or admin sets up Context.dev or Treg in Settings → Connections.",
    );
  }
  return { provider, fetcher };
}

/** Looks each selected record up and settles it; one that throws is that record's failure alone. */
async function run<Row extends { id: string }>(
  ids: string[],
  rows: Row[],
  provider: EnrichmentProvider,
  enrich: (row: Row) => Promise<EnrichmentRecordResult>,
): Promise<EnrichmentRunResult> {
  const results = await Promise.all(
    unique(ids).map(async (id): Promise<EnrichmentRecordResult> => {
      const row = rows.find((candidate) => candidate.id === id);
      if (!row) {
        return { id, outcome: "skipped", reason: "It no longer exists." };
      }
      try {
        return await enrich(row);
      } catch (error) {
        console.error("[enrichment] a lookup failed", {
          provider,
          ...loggableError(error),
        });
        return { id, outcome: "failed", reason: "Something went wrong." };
      }
    }),
  );
  return { provider, results };
}

/** A lookup that found nothing to write, as the record's result. */
function unfound(
  id: string,
  lookup: Exclude<Lookup<unknown>, { outcome: "found" }>,
): EnrichmentRecordResult {
  return { id, outcome: lookup.outcome, reason: lookup.reason };
}

/** "title and LinkedIn", "logo, industry and location". */
function listOf(labels: (string | null)[]): string {
  const named = unique(labels.filter((label) => label !== null));
  if (named.length < 2) return named[0] ?? "";
  return `${named.slice(0, -1).join(", ")} and ${named.at(-1)}`;
}

async function enrichContacts(
  caller: Caller,
  ids: string[],
): Promise<EnrichmentRunResult> {
  const { organizationId } = caller;
  const { provider, fetcher } = await providerFor(organizationId, "contact");
  const rows = await EnrichmentRepository.contacts(organizationId, ids);
  return run(ids, rows, provider, async (row) => {
    const lookup = await PROVIDERS[provider].person(
      fetcher,
      row,
      organizationId,
    );
    if (lookup.outcome !== "found") return unfound(row.id, lookup);
    const { imageUrl: photo, ...facts } = lookup.facts;
    // A photograph's source URL expires, so only our own copy is stored.
    const imageUrl =
      photo && !row.imageUrl
        ? await storeImage(organizationId, `contacts/${row.id}/photo`, photo)
        : null;
    const filled = await EnrichmentRepository.fillContact(
      organizationId,
      row.id,
      { ...facts, ...(imageUrl ? { imageUrl } : {}) },
    );
    if (filled.length === 0) {
      return { id: row.id, outcome: "nothing", reason: null };
    }
    await ActivityRepository.insert({
      organizationId,
      type: "ENRICHMENT",
      subject: `Enriched with ${ENRICHMENT_PROVIDER_NAMES[provider]}`,
      body: `Filled in ${listOf(filled.map((field) => PERSON_LABELS[field]))}.`,
      occurredAt: new Date().toISOString(),
      dueAt: null,
      companyId: null,
      contactId: row.id,
      dealId: null,
      createdById: caller.userId,
      meta: { provider, fields: filled },
    });
    return { id: row.id, outcome: "enriched", reason: null };
  });
}

async function enrichCompanies(
  caller: Caller,
  ids: string[],
): Promise<EnrichmentRunResult> {
  const { organizationId } = caller;
  const { provider, fetcher } = await providerFor(organizationId, "company");
  const rows = await EnrichmentRepository.companies(organizationId, ids);
  return run(ids, rows, provider, async (row) => {
    const lookup = await PROVIDERS[provider].company(
      fetcher,
      row,
      organizationId,
    );
    if (lookup.outcome !== "found") return unfound(row.id, lookup);
    const facts = { ...lookup.facts };
    // Copy the pictures the company still lacks. One that can't be copied
    // keeps its source URL: a logo's, unlike a photograph's, lasts.
    await Promise.all(
      COMPANY_IMAGE_FIELDS.map(async (slot) => {
        const source = facts[slot];
        if (!source || row[slot]) return;
        const stored = await storeImage(
          organizationId,
          `companies/${row.id}/${slot}`,
          source,
        );
        if (stored) facts[slot] = stored;
      }),
    );
    const filled = await EnrichmentRepository.fillCompany(
      organizationId,
      row.id,
      facts,
    );
    if (filled.length === 0) {
      return { id: row.id, outcome: "nothing", reason: null };
    }
    await ActivityRepository.insert({
      organizationId,
      type: "ENRICHMENT",
      subject: `Enriched with ${ENRICHMENT_PROVIDER_NAMES[provider]}`,
      body: `Filled in ${listOf(filled.map((field) => COMPANY_LABELS[field]))}.`,
      occurredAt: new Date().toISOString(),
      dueAt: null,
      companyId: row.id,
      contactId: null,
      dealId: null,
      createdById: caller.userId,
      meta: { provider, fields: filled },
    });
    return { id: row.id, outcome: "enriched", reason: null };
  });
}

export const EnrichmentService = {
  getSettings,
  setPreferred,
  enrichContacts,
  enrichCompanies,
};
