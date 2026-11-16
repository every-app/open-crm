// Enrichment: a member selects contacts or companies and asks a data provider
// to fill in what they are missing. It runs only when asked, on the selection,
// with whichever provider the workspace prefers for that kind of record.

export const ENRICHMENT_PROVIDERS = ["context", "treg"] as const;
export type EnrichmentProvider = (typeof ENRICHMENT_PROVIDERS)[number];

export const ENRICHMENT_PROVIDER_NAMES = {
  context: "Context.dev",
  treg: "Treg",
} as const satisfies Record<EnrichmentProvider, string>;

export const ENRICHMENT_KINDS = ["contact", "company"] as const;
export type EnrichmentKind = (typeof ENRICHMENT_KINDS)[number];

/** The most records one request enriches; the browser sends a selection in runs of these. */
export const ENRICHMENT_RUN_SIZE = 5;

/**
 * How one record's lookup went. `enriched`: fields were filled. `nothing`:
 * the provider knew them, and the record already had everything it offered.
 * `skipped`: nothing to look them up by, or the provider had no match.
 * `failed`: the lookup itself failed.
 */
export type EnrichmentOutcome = "enriched" | "nothing" | "skipped" | "failed";

export type EnrichmentRecordResult = {
  id: string;
  outcome: EnrichmentOutcome;
  /** Why it was skipped or failed, in words for the member. */
  reason: string | null;
};

export type EnrichmentRunResult = {
  provider: EnrichmentProvider;
  results: EnrichmentRecordResult[];
};

/** A provider as Settings → Connections shows it. */
export type EnrichmentProviderStatus = {
  provider: EnrichmentProvider;
  /** Lookups would go through: the gateway holds its key. */
  ready: boolean;
  /** What is missing, in the gateway's words, while it isn't ready. */
  setup: string | null;
  /** The command that sets it, for an owner or admin. */
  command: string | null;
};

export type EnrichmentSettings = {
  providers: EnrichmentProviderStatus[];
  /** The workspace's choice for each kind; null until one is made. */
  preferred: Record<EnrichmentKind, EnrichmentProvider | null>;
  /** The provider a run would use now: the preferred one when it is ready, else the other. */
  active: Record<EnrichmentKind, EnrichmentProvider | null>;
};
