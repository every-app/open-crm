import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import { company, companyEnrichment, contact } from "@/db/schema";
import {
  BRAND_FIELDS,
  type BrandField,
  type BrandUpdate,
} from "../visible/brandMapping";

// The visible lane's writes: a company's brand or favicon, and a contact's
// photograph.
// Both fill blanks with conditional SQL rather than read-then-write, so a value
// a person types while a lookup is in flight is never overwritten.

const brandColumns = {
  name: company.name,
  description: company.description,
  logoUrl: company.logoUrl,
  logoDarkUrl: company.logoDarkUrl,
  iconUrl: company.iconUrl,
  iconDarkUrl: company.iconDarkUrl,
  iconTone: company.iconTone,
  brandColor: company.brandColor,
  industry: company.industry,
  subIndustry: company.subIndustry,
  city: company.city,
  stateCode: company.stateCode,
  country: company.country,
  countryCode: company.countryCode,
  phone: company.phone,
  email: company.email,
  linkedinUrl: company.linkedinUrl,
  twitterUrl: company.twitterUrl,
  githubUrl: company.githubUrl,
  pricingUrl: company.pricingUrl,
  careersUrl: company.careersUrl,
} satisfies Record<BrandField, unknown>;

/** The company as the brand mapping needs it, or null when it isn't the organization's. */
async function companyForBrand(organizationId: string, companyId: string) {
  const [row] = await db
    .select({ ...brandColumns, domain: company.domain })
    .from(company)
    .where(
      and(
        eq(company.organizationId, organizationId),
        eq(company.id, companyId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** A column's new value: `value` where the column is still fillable. */
function filled(field: BrandField, value: string): SQL {
  if (field === "iconUrl") return sql`${value}`;
  if (field === "name") {
    return sql`case when ${company.name} = ${company.domain} then ${value} else ${company.name} end`;
  }
  return sql`coalesce(${company[field]}, ${value})`;
}

/**
 * Writes the brand onto the company's blanks, marks its enrichment complete,
 * and keeps Context.dev's raw answer beside it, in one batch.
 */
async function fillCompanyBrand(
  organizationId: string,
  companyId: string,
  update: BrandUpdate,
  raw: unknown,
): Promise<void> {
  const now = new Date().toISOString();
  const values: Partial<Record<BrandField, SQL>> = {};
  for (const field of BRAND_FIELDS) {
    const value = update[field];
    if (value !== undefined) values[field] = filled(field, value);
  }
  await runBatch((tx) => [
    tx
      .update(company)
      .set({
        ...values,
        enrichmentStatus: "COMPLETE",
        enrichedAt: now,
        enrichmentError: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(company.organizationId, organizationId),
          eq(company.id, companyId),
        ),
      ),
    tx
      .insert(companyEnrichment)
      .values({ companyId, organizationId, raw, fetchedAt: now })
      .onConflictDoUpdate({
        target: companyEnrichment.companyId,
        set: { raw, fetchedAt: now },
        setWhere: eq(companyEnrichment.organizationId, organizationId),
      }),
  ]);
}

/**
 * Puts a favicon on a company that still has no icon and still has the
 * domain it was found on. True when it was written.
 */
async function setCompanyIcon(
  organizationId: string,
  companyId: string,
  domain: string,
  iconUrl: string,
): Promise<boolean> {
  const updated = await db
    .update(company)
    .set({ iconUrl, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(company.organizationId, organizationId),
        eq(company.id, companyId),
        isNull(company.iconUrl),
        eq(company.domain, domain),
      ),
    )
    .returning({ id: company.id });
  return updated.length > 0;
}

async function contactForPortrait(organizationId: string, contactId: string) {
  const [row] = await db
    .select({
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      imageUrl: contact.imageUrl,
      linkedinUrl: contact.linkedinUrl,
      githubUrl: contact.githubUrl,
      companyName: company.name,
      companyDomain: company.domain,
    })
    .from(contact)
    .leftJoin(
      company,
      and(
        eq(company.id, contact.companyId),
        eq(company.organizationId, organizationId),
      ),
    )
    .where(
      and(
        eq(contact.organizationId, organizationId),
        eq(contact.id, contactId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Puts the stored photograph on the contact: only into an empty slot unless
 * `replace`. True when it was written.
 */
async function setContactImage(
  organizationId: string,
  contactId: string,
  imageUrl: string,
  replace: boolean,
): Promise<boolean> {
  const updated = await db
    .update(contact)
    .set({ imageUrl, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(contact.organizationId, organizationId),
        eq(contact.id, contactId),
        replace ? undefined : isNull(contact.imageUrl),
      ),
    )
    .returning({ id: contact.id });
  return updated.length > 0;
}

export const AgentEnrichmentRepository = {
  companyForBrand,
  fillCompanyBrand,
  setCompanyIcon,
  contactForPortrait,
  setContactImage,
};
