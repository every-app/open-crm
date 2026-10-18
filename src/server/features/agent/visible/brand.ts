import { storeImage } from "@/server/lib/images";
import {
  getContextFetch,
  hasContextAccess,
} from "@/server/lib/provider-access";
import type { EnrichmentStatus } from "@/shared/crm-enums";
import { brandByDomain, type ContextFetch } from "../lib/contextDev";
import { resolveFavicon } from "../lib/favicon";
import { AgentEnrichmentRepository } from "../repositories/AgentEnrichmentRepository";
import {
  AgentRecordRepository,
  type StatusGuard,
} from "../repositories/AgentRecordRepository";
import { BILLABLE_CALL_UNITS, FREE, type Spend } from "../runtime/budget";
import {
  BRAND_FIELDS,
  brandToUpdate,
  COMPANY_IMAGE_FIELDS,
  stillFillable,
  type BrandField,
  type BrandUpdate,
} from "./brandMapping";

// A company's brand from Context.dev (logo, colors, industry, location,
// socials), ported from the CRM's lib/brand.ts. It runs in the visible lane
// for every new company, and as the agent's enrich_company tool. Where it
// leaves the company without an icon, the visible lane falls back on the
// company's own favicon (storeFavicon), as the CRM did.

type BrandResult = {
  enriched: boolean;
  filled?: BrandField[];
  mirrored?: BrandField[];
  reason?: string;
  retryable?: boolean;
};

export const NO_CONTEXT_REASON =
  "Context.dev is not configured, so there is nowhere to look.";

/**
 * Context.dev's fetch when calls would go through: the gateway (or, in local
 * dev, .dev.vars) holds a key. Null otherwise.
 */
export async function contextAccess(): Promise<ContextFetch | null> {
  const contextFetch = await getContextFetch();
  if (!contextFetch) return null;
  return (await hasContextAccess()) ? contextFetch : null;
}

export async function runBrand(input: {
  organizationId: string;
  companyId: string;
  fresh?: boolean;
  spend?: Spend;
}): Promise<BrandResult> {
  const { organizationId, companyId } = input;
  const company = await AgentEnrichmentRepository.companyForBrand(
    organizationId,
    companyId,
  );
  if (!company) return { enriched: false, reason: "No such company." };
  const contextFetch = await contextAccess();
  if (!contextFetch) {
    // Only a lookup that started may settle: a PENDING company stays PENDING
    // for when a key exists.
    await settleCompany(
      organizationId,
      companyId,
      "SKIPPED",
      NO_CONTEXT_REASON,
    );
    return { enriched: false, reason: NO_CONTEXT_REASON };
  }
  if (!company.domain) {
    await settleCompany(
      organizationId,
      companyId,
      "SKIPPED",
      "No domain to look up.",
      "unlessComplete",
    );
    return { enriched: false, reason: "No domain on this company." };
  }
  const charge = (input.spend ?? FREE)(BILLABLE_CALL_UNITS);
  if (!charge.ok) return { enriched: false, reason: charge.reason };
  await AgentRecordRepository.setEnrichmentStatus(
    organizationId,
    { contactId: null, companyId },
    "RUNNING",
    null,
    "unlessComplete",
  );
  const result = await brandByDomain(
    contextFetch,
    company.domain,
    input.fresh ? 0 : undefined,
  );
  if (result.outcome === "skipped") {
    await settleCompany(organizationId, companyId, "SKIPPED", result.reason);
    return { enriched: false, reason: result.reason };
  }
  if (result.outcome === "failed") {
    await settleCompany(organizationId, companyId, "FAILED", result.reason);
    return {
      enriched: false,
      reason: result.reason,
      retryable: result.retryable,
    };
  }
  const update = brandToUpdate(result.brand, company);
  const mirrored = await mirrorBrandImages(organizationId, companyId, update);
  // Fill against the company as it is now: someone may have typed a value
  // while the lookup ran.
  const current = await AgentEnrichmentRepository.companyForBrand(
    organizationId,
    companyId,
  );
  if (!current) return { enriched: false, reason: "No such company." };
  const kept = stillFillable(update, current);
  await AgentEnrichmentRepository.fillCompanyBrand(
    organizationId,
    companyId,
    kept,
    result.raw,
  );
  const filled = BRAND_FIELDS.filter((field) => kept[field] !== undefined);
  return {
    enriched: true,
    filled,
    mirrored: mirrored.filter((slot) => filled.includes(slot)),
  };
}

/** Copies the logos into R2, so the record points at our copy. */
async function mirrorBrandImages(
  organizationId: string,
  companyId: string,
  update: BrandUpdate,
): Promise<BrandField[]> {
  const mirrored: BrandField[] = [];
  await Promise.all(
    COMPANY_IMAGE_FIELDS.map(async (slot) => {
      const source = update[slot];
      if (!source) return;
      const stored = await storeImage(
        organizationId,
        `companies/${companyId}/${slot}`,
        source,
      );
      // A logo that can't be copied keeps its source URL, as in the CRM.
      if (!stored) return;
      update[slot] = stored;
      mirrored.push(slot);
    }),
  );
  return mirrored;
}

/**
 * The company's own favicon as its icon, when it still has none: free, from
 * its site (lib/favicon.ts), and copied into R2 like every logo. A favicon
 * that can't be copied keeps its source URL, as in the CRM. A brand lookup
 * that finds an icon later replaces it. True when it was stored.
 */
export async function storeFavicon(input: {
  organizationId: string;
  companyId: string;
}): Promise<boolean> {
  const { organizationId, companyId } = input;
  const company = await AgentEnrichmentRepository.companyForBrand(
    organizationId,
    companyId,
  );
  if (!company?.domain || company.iconUrl) return false;
  const source = await resolveFavicon(company.domain);
  if (!source) return false;
  const stored = await storeImage(
    organizationId,
    `companies/${companyId}/icon`,
    source,
  );
  return AgentEnrichmentRepository.setCompanyIcon(
    organizationId,
    companyId,
    company.domain,
    stored ?? source,
  );
}

export function brandOutcome(result: BrandResult): string {
  if (!result.enriched) return result.reason ?? "Nothing to fill.";
  const filled = result.filled ?? [];
  const mirrored = result.mirrored ?? [];
  if (filled.length === 0) {
    return "Everything Context.dev returned was already on the record.";
  }
  return `Filled ${filled.join(", ")}.${mirrored.length > 0 ? ` Copied ${mirrored.length} image(s) in-house.` : ""}`;
}

async function settleCompany(
  organizationId: string,
  companyId: string,
  status: EnrichmentStatus,
  error: string,
  guard: StatusGuard = { statuses: ["RUNNING"] },
): Promise<void> {
  await AgentRecordRepository.setEnrichmentStatus(
    organizationId,
    { contactId: null, companyId },
    status,
    error,
    guard,
  );
}
