import { AgentTaskService } from "@/server/features/agent/services/AgentTaskService";
import { ArchiveService } from "@/server/features/archive/services/ArchiveService";
import { CompanyDirectoryRepository } from "@/server/features/companies/repositories/CompanyDirectoryRepository";
import { CompanyRelationsRepository } from "@/server/features/companies/repositories/CompanyRelationsRepository";
import { CompanyRepository } from "@/server/features/companies/repositories/CompanyRepository";
import { FieldValuesService } from "@/server/features/fields/services/FieldValuesService";
import { FieldsService } from "@/server/features/fields/services/FieldsService";
import {
  assertOwner,
  blankToNull,
  bulkOutcome,
  isUniqueViolation,
  recordAgentStates,
  runBulk,
} from "@/server/features/records/recordRules";
import { pokeEvents } from "@/server/features/team-agents/runtime/poke";
import { WorkspaceRepository } from "@/server/features/workspace/repositories/WorkspaceRepository";
import { requireCredits } from "@/server/billing/credits";
import { AppError } from "@/server/lib/errors";
import type { RecordSource } from "@/shared/crm-enums";
import { domainFromEmail, normalizeDomain } from "@/shared/domain";
import type {
  CompanyListInput,
  CreateCompanyInput,
  UpdateCompanyInput,
} from "@/types/schemas/companies";
import type { BulkResult } from "@/types/schemas/records";

// Companies: the accounts in the pipeline. A live company's domain is unique
// in its organization (an archived one keeps its domain, so a restore can
// conflict). A new company, or one whose domain changed, sends the research
// agent to fetch its brand and write its profile.

function notFound(id: string): never {
  throw new AppError("NOT_FOUND", `No company with id ${id}.`);
}

/** The bare host of a domain or website, null for a blank one. */
function domainOf(input: string | undefined): string | null {
  const trimmed = input?.trim();
  if (!trimmed) return null;
  const domain = normalizeDomain(trimmed);
  if (!domain) {
    throw new AppError(
      "VALIDATION_ERROR",
      `"${trimmed}" is not a domain. Try one like stripe.com.`,
    );
  }
  return domain;
}

async function requireCompany(organizationId: string, id: string) {
  return (await CompanyRepository.findById(organizationId, id)) ?? notFound(id);
}

/**
 * A page of the list, its custom field filters applied in the same query as
 * the rest, each row with its values for the fields shown as columns; and
 * how many companies its search finds have each value of its filters.
 */
async function listCompanies(organizationId: string, input: CompanyListInput) {
  const fieldConditions = await FieldValuesService.filterConditions(
    organizationId,
    "COMPANY",
    input.fields,
  );
  const [{ rows, total }, facetCounts, fieldFacetCounts] = await Promise.all([
    CompanyRepository.list(organizationId, input, fieldConditions),
    CompanyRepository.facetCounts(organizationId, input),
    FieldValuesService.facetCounts(
      organizationId,
      "COMPANY",
      CompanyRepository.idsInScope(organizationId, input),
    ),
  ]);
  const ids = rows.map((row) => row.id);
  const [agent, fields] = await Promise.all([
    recordAgentStates(organizationId, "company", ids),
    FieldValuesService.tableValues(organizationId, "COMPANY", ids),
  ]);
  return {
    rows: rows.map((row) => ({
      ...row,
      queued: agent.queued.has(row.id),
      waiting: agent.waiting.has(row.id),
      fields: fields[row.id] ?? {},
    })),
    total,
    facetCounts: { ...facetCounts, ...fieldFacetCounts },
  };
}

export type CompanyListRow = Awaited<
  ReturnType<typeof listCompanies>
>["rows"][number];

/** A company with what its sheet shows: owner, people, deals, queue state. */
async function getCompany(organizationId: string, id: string) {
  const { organizationId: _, ...found } = await requireCompany(
    organizationId,
    id,
  );
  const [contacts, deals, primaryContact, agent, workspace] = await Promise.all(
    [
      CompanyRelationsRepository.listContacts(organizationId, id),
      CompanyRelationsRepository.listDeals(organizationId, id),
      found.primaryContactId
        ? CompanyRelationsRepository.findContact(
            organizationId,
            found.primaryContactId,
          )
        : null,
      recordAgentStates(organizationId, "company", [id]),
      WorkspaceRepository.getOrCreate(organizationId),
    ],
  );
  return {
    ...found,
    primaryContact,
    contacts,
    deals,
    queued: agent.queued.has(id),
    waiting: agent.waiting.has(id),
    // Deal totals are summed in the workspace's reporting currency.
    reportingCurrency: workspace.reportingCurrency ?? "USD",
  };
}

export type CompanyDetail = Awaited<ReturnType<typeof getCompany>>;

async function companyOptions(organizationId: string, q: string) {
  return CompanyRepository.options(organizationId, q);
}

async function createCompany(
  organizationId: string,
  input: CreateCompanyInput,
) {
  const domain = domainOf(input.domain);
  await assertOwner(organizationId, input.ownerId);
  const name = input.name.trim();
  let id: string;
  try {
    id = await CompanyDirectoryRepository.create(
      {
        organizationId,
        name,
        domain,
        website: domain ? `https://${domain}` : null,
        ownerId: input.ownerId ?? null,
      },
      [{ type: "company.created", data: { name, domain } }],
    );
  } catch (error) {
    const taken =
      domain && isUniqueViolation(error)
        ? await CompanyDirectoryRepository.findLive(organizationId, domain)
        : null;
    if (!taken) throw error;
    throw new AppError(
      "CONFLICT",
      `${taken.name} already uses the domain ${domain}.`,
    );
  }
  console.log("[companies] created", { organizationId, companyId: id, domain });
  pokeEvents(organizationId);
  await AgentTaskService.companyAddedByPerson(organizationId, id);
  await FieldsService.queueFillForNewRecord(organizationId, "COMPANY", id);
  return { id, name, domain };
}

// Text fields a person edits as typed; a blank one clears the field.
const TEXT_FIELDS = [
  "website",
  "description",
  "industry",
  "city",
  "stateCode",
  "country",
  "phone",
  "email",
  "linkedinUrl",
] as const;

type CompanyPatch = Parameters<typeof CompanyRepository.update>[2];

async function updateCompany(
  organizationId: string,
  input: UpdateCompanyInput,
) {
  const { id, name, domain, ownerId } = input;
  const patch: CompanyPatch = {};
  if (name !== undefined) patch.name = name.trim();
  for (const key of TEXT_FIELDS) {
    const value = input[key];
    if (value !== undefined) patch[key] = blankToNull(value);
  }
  if (ownerId !== undefined) {
    await assertOwner(organizationId, ownerId);
    patch.ownerId = ownerId;
  }
  let domainChanged = false;
  if (domain !== undefined) {
    patch.domain = domainOf(domain);
    const current = await requireCompany(organizationId, id);
    if (current.domain !== patch.domain) {
      // Everything known was about a different company.
      domainChanged = true;
      Object.assign(patch, {
        enrichmentStatus: "PENDING",
        enrichmentError: null,
        iconUrl: null,
        iconDarkUrl: null,
        iconTone: null,
      } satisfies CompanyPatch);
    }
  }
  let updated: Awaited<ReturnType<typeof CompanyRepository.update>>;
  try {
    updated = await CompanyRepository.update(organizationId, id, patch);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(
        "CONFLICT",
        "Another company already uses that domain.",
      );
    }
    throw error;
  }
  if (!updated) notFound(id);
  if (domainChanged) {
    await AgentTaskService.companyAddedByPerson(
      organizationId,
      id,
      "Domain changed: anything known was about a different company",
    );
  }
  return updated;
}

async function archiveCompany(organizationId: string, id: string) {
  const found = await requireCompany(organizationId, id);
  await CompanyRepository.archive(organizationId, [id]);
  console.log("[companies] archived", { organizationId, companyId: id });
  return { id, name: found.name };
}

async function restoreCompany(organizationId: string, id: string) {
  let restored: Awaited<ReturnType<typeof CompanyRepository.restore>>;
  try {
    restored = await CompanyRepository.restore(organizationId, id);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(
        "CONFLICT",
        "A live company already uses this company's domain.",
      );
    }
    throw error;
  }
  // Not archived (or not the organization's): nothing to bring back.
  if (!restored)
    return { id, name: (await requireCompany(organizationId, id)).name };
  console.log("[companies] restored", { organizationId, companyId: id });
  return restored;
}

/** Deletes an archived company forever (owners and admins only). */
async function purgeCompany(organizationId: string, id: string) {
  const found = await requireCompany(organizationId, id);
  if (!found.archivedAt) {
    throw new AppError(
      "CONFLICT",
      "Only an archived company can be deleted forever. Archive it first.",
    );
  }
  const purged = await ArchiveService.purgeArchived(
    organizationId,
    "company",
    [id],
    new Date().toISOString(),
  );
  if (purged.length === 0) {
    throw new AppError(
      "CONFLICT",
      "The company was restored before it could be deleted.",
    );
  }
  console.log("[companies] purged", { organizationId, companyId: id });
  return { id, name: found.name };
}

/**
 * A person asked the agent to look at the company again. True when anything
 * was queued; false when the agent is already on it. Refused when the
 * workspace is out of credits (hosted billing).
 */
async function enrichCompany(organizationId: string, id: string) {
  await requireCredits({ organizationId });
  return requestEnrichment(organizationId, id);
}

async function requestEnrichment(organizationId: string, id: string) {
  const found = await requireCompany(organizationId, id);
  const queued = await AgentTaskService.companyRequested(
    organizationId,
    id,
    "A person asked for a fresh look",
  );
  if (queued) {
    await CompanyRepository.markEnrichmentRequested(
      organizationId,
      id,
      found.updatedAt,
    );
  }
  return { id, queued };
}

async function setPrimaryContact(
  organizationId: string,
  companyId: string,
  contactId: string | null,
) {
  await requireCompany(organizationId, companyId);
  if (contactId) {
    const person = await CompanyRelationsRepository.findContact(
      organizationId,
      contactId,
    );
    if (!person) {
      throw new AppError("NOT_FOUND", `No contact with id ${contactId}.`);
    }
    if (person.companyId !== companyId) {
      throw new AppError(
        "VALIDATION_ERROR",
        "That contact does not work at this company.",
      );
    }
  }
  await CompanyRepository.setPrimaryContact(
    organizationId,
    companyId,
    contactId,
  );
  return { id: companyId, primaryContactId: contactId };
}

async function bulkAssignOwner(
  organizationId: string,
  ids: string[],
  ownerId: string | null,
): Promise<BulkResult> {
  await assertOwner(organizationId, ownerId);
  const unique = [...new Set(ids)];
  const changed = await CompanyRepository.setOwner(
    organizationId,
    unique,
    ownerId,
  );
  return bulkOutcome(unique.length, changed);
}

async function bulkArchive(
  organizationId: string,
  ids: string[],
): Promise<BulkResult> {
  const unique = [...new Set(ids)];
  const archived = await CompanyRepository.archive(organizationId, unique);
  return bulkOutcome(unique.length, archived.length);
}

async function bulkEnrich(organizationId: string, ids: string[]) {
  await requireCredits({ organizationId });
  return runBulk(ids, (id) => requestEnrichment(organizationId, id));
}

function bulkRestore(organizationId: string, ids: string[]) {
  return runBulk(ids, (id) => restoreCompany(organizationId, id));
}

function bulkPurge(organizationId: string, ids: string[]) {
  return runBulk(ids, (id) => purgeCompany(organizationId, id));
}

/**
 * The live company behind a work email's domain, added (named after the
 * domain, for the agent to research) when there isn't one; null for free
 * mail and machine senders. For contacts: `ownerId` is one the caller checked.
 * `source` says where an added company came from (mail capture's EMAIL or
 * CALENDAR).
 */
async function companyForEmail(
  organizationId: string,
  email: string,
  ownerId: string | null = null,
  source?: RecordSource,
): Promise<string | null> {
  const domain = domainFromEmail(email);
  if (!domain) return null;
  const existing = await CompanyDirectoryRepository.findLive(
    organizationId,
    domain,
  );
  if (existing) return existing.id;
  let id: string;
  try {
    id = await CompanyDirectoryRepository.create(
      {
        organizationId,
        name: domain,
        domain,
        website: `https://${domain}`,
        ownerId,
        source,
      },
      [{ type: "company.created", data: { name: domain, domain } }],
    );
  } catch (error) {
    // Another request added the domain first.
    const first = isUniqueViolation(error)
      ? await CompanyDirectoryRepository.findLive(organizationId, domain)
      : null;
    if (!first) throw error;
    return first.id;
  }
  pokeEvents(organizationId);
  await AgentTaskService.companyCreated(
    organizationId,
    id,
    `Created from an email domain (${domain}): it has no name but the domain`,
  );
  await FieldsService.queueFillForNewRecord(organizationId, "COMPANY", id);
  return id;
}

export const CompanyService = {
  listCompanies,
  getCompany,
  companyOptions,
  createCompany,
  updateCompany,
  archiveCompany,
  restoreCompany,
  purgeCompany,
  enrichCompany,
  setPrimaryContact,
  bulkAssignOwner,
  bulkArchive,
  bulkEnrich,
  bulkRestore,
  bulkPurge,
  companyForEmail,
};
