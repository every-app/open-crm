import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import { company } from "@/db/schema";
import {
  fieldValueWrites,
  type FieldWrite,
} from "@/server/features/fields/repositories/FieldValueRepository";
import type { NewCompany } from "./CompanyRepository";

// Companies as the CRM adds them by hand or for an email domain (its
// companies.service create and company-directory.service): the live company
// that has a domain, and a new company written with its custom field values
// in one batch.

/** The organization's live company with `domain`, if any. */
async function findLive(organizationId: string, domain: string) {
  const [row] = await db
    .select({ id: company.id, name: company.name })
    .from(company)
    .where(
      and(
        eq(company.organizationId, organizationId),
        eq(company.domain, domain),
        isNull(company.archivedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Adds the company with the custom field values it is created with, in one
 * batch: all or none. Throws a
 * unique violation when a live company of the organization already has its
 * domain (company_organization_domain_active_uidx). The new id.
 */
async function create(values: NewCompany, fields: FieldWrite[] = []) {
  const { organizationId } = values;
  const id = crypto.randomUUID();
  await runBatch((tx) => [
    tx.insert(company).values({ ...values, id }),
    ...fieldValueWrites(tx, organizationId, "COMPANY", id, fields),
  ]);
  return id;
}

export const CompanyDirectoryRepository = { findLive, create };
