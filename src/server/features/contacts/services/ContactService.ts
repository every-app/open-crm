import { AgentTaskService } from "@/server/features/agent/services/AgentTaskService";
import { ArchiveService } from "@/server/features/archive/services/ArchiveService";
import { CompanyService } from "@/server/features/companies/services/CompanyService";
import { ContactFactRepository } from "@/server/features/contacts/repositories/ContactFactRepository";
import { ContactRelationsRepository } from "@/server/features/contacts/repositories/ContactRelationsRepository";
import { ContactRepository } from "@/server/features/contacts/repositories/ContactRepository";
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
import { AppError } from "@/server/lib/errors";
import { normalizeEmail } from "@/shared/domain";
import type {
  ContactListInput,
  CreateContactInput,
  UpdateContactInput,
} from "@/types/schemas/contacts";
import type { BulkResult } from "@/types/schemas/records";

// Contacts: the people in the pipeline. A live contact's email is stored
// lowercased and is unique in its organization (an archived one keeps its
// email, so a restore can conflict). A new contact without a company is
// filed under the company behind its work email, and sends the research
// agent to identify the person (ContactFactService settles what it finds).

function notFound(id: string): never {
  throw new AppError("NOT_FOUND", `No contact with id ${id}.`);
}

function nameOf(person: { firstName: string; lastName: string | null }) {
  return [person.firstName, person.lastName].filter(Boolean).join(" ");
}

/** The address lowercased, null for a blank one; refuses a non-address. */
function emailOf(input: string | undefined): string | null {
  const trimmed = input?.trim();
  if (!trimmed) return null;
  const email = normalizeEmail(trimmed);
  if (!email) {
    throw new AppError("VALIDATION_ERROR", "That is not an email address.");
  }
  return email;
}

async function requireContact(organizationId: string, id: string) {
  return (await ContactRepository.findById(organizationId, id)) ?? notFound(id);
}

async function requireLiveCompany(organizationId: string, companyId: string) {
  if (
    !(await ContactRelationsRepository.isLiveCompany(organizationId, companyId))
  ) {
    throw new AppError("NOT_FOUND", `No live company with id ${companyId}.`);
  }
}

/**
 * A page of the list, its custom field filters applied in the same query as
 * the rest, each row with its values for the fields shown as columns.
 */
async function listContacts(organizationId: string, input: ContactListInput) {
  const { rows, total } = await ContactRepository.list(
    organizationId,
    input,
    await FieldValuesService.filterConditions(
      organizationId,
      "CONTACT",
      input.fields,
    ),
  );
  const ids = rows.map((row) => row.id);
  const [agent, fields] = await Promise.all([
    recordAgentStates(organizationId, "contact", ids),
    FieldValuesService.tableValues(organizationId, "CONTACT", ids),
  ]);
  return {
    rows: rows.map((row) => ({
      ...row,
      queued: agent.queued.has(row.id),
      waiting: agent.waiting.has(row.id),
      fields: fields[row.id] ?? {},
    })),
    total,
  };
}

export type ContactListRow = Awaited<
  ReturnType<typeof listContacts>
>["rows"][number];

/**
 * A contact with what its sheet shows: owner, company, the agent's brief
 * and open facts, the deals they're on, the colleagues and mail around them,
 * and whether the agent is queued for them.
 */
async function getContact(organizationId: string, id: string) {
  const { organizationId: _, ...found } = await requireContact(
    organizationId,
    id,
  );
  const [facts, brief, deals, colleagues, relationship, agent] =
    await Promise.all([
      ContactFactRepository.listOpen(organizationId, id),
      ContactFactRepository.findBrief(organizationId, id),
      ContactRelationsRepository.listDeals(organizationId, id),
      found.companyId
        ? ContactRelationsRepository.listColleagues(
            organizationId,
            id,
            found.companyId,
          )
        : [],
      ContactRelationsRepository.relationship(organizationId, id),
      recordAgentStates(organizationId, "contact", [id]),
    ]);
  return {
    ...found,
    isPrimaryContact: found.company?.primaryContactId === id,
    brief,
    facts,
    deals,
    relationship: {
      ...relationship,
      colleagues: colleagues.map((colleague) => ({
        id: colleague.id,
        name: nameOf(colleague),
        title: colleague.title,
      })),
    },
    queued: agent.queued.has(id),
    waiting: agent.waiting.has(id),
  };
}

export type ContactDetail = Awaited<ReturnType<typeof getContact>>;

async function createContact(
  organizationId: string,
  input: CreateContactInput,
) {
  const email = emailOf(input.email);
  const ownerId = input.ownerId ?? null;
  await assertOwner(organizationId, ownerId);
  // Before the company: a refused contact leaves no company behind.
  if (email) {
    const existing = await ContactRepository.findLiveByEmail(
      organizationId,
      email,
    );
    if (existing) {
      throw new AppError(
        "CONFLICT",
        `${nameOf(existing)} already uses ${email}.`,
      );
    }
  }
  if (input.companyId)
    await requireLiveCompany(organizationId, input.companyId);
  const companyId =
    input.companyId ??
    (email
      ? await CompanyService.companyForEmail(organizationId, email, ownerId)
      : null);
  const firstName = input.firstName.trim();
  const lastName = blankToNull(input.lastName ?? "");
  let id: string;
  try {
    id = await ContactRepository.insert({
      organizationId,
      firstName,
      lastName,
      email,
      phone: blankToNull(input.phone ?? ""),
      title: blankToNull(input.title ?? ""),
      companyId,
      ownerId,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(
        "CONFLICT",
        "Another contact already uses that email address.",
      );
    }
    throw error;
  }
  console.log("[contacts] created", {
    organizationId,
    contactId: id,
    companyId,
  });
  await AgentTaskService.contactCreated(
    organizationId,
    id,
    "Added by a person, with nothing on the record yet",
  );
  await AgentTaskService.crmEvent(organizationId, {
    type: "contact.created",
    recordId: id,
    data: { firstName, lastName, companyId },
  });
  await FieldsService.queueFillForNewRecord(organizationId, "CONTACT", id);
  return { id, firstName, lastName, companyId };
}

// Text fields a person edits as typed; a blank one clears the field.
const TEXT_FIELDS = [
  "lastName",
  "phone",
  "title",
  "linkedinUrl",
  "twitterUrl",
  "githubUrl",
] as const;

type ContactPatch = Parameters<typeof ContactRepository.update>[2];

async function updateContact(
  organizationId: string,
  input: UpdateContactInput,
) {
  const { id, firstName, email, companyId, ownerId } = input;
  const patch: ContactPatch = {};
  if (firstName !== undefined) patch.firstName = firstName.trim();
  for (const key of TEXT_FIELDS) {
    const value = input[key];
    if (value !== undefined) patch[key] = blankToNull(value);
  }
  if (email !== undefined) patch.email = emailOf(email);
  if (ownerId !== undefined) {
    await assertOwner(organizationId, ownerId);
    patch.ownerId = ownerId;
  }
  if (companyId !== undefined) {
    if (companyId) await requireLiveCompany(organizationId, companyId);
    patch.companyId = companyId;
  }
  await requireContact(organizationId, id);
  try {
    return (
      (await ContactRepository.update(organizationId, id, patch)) ??
      notFound(id)
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(
        "CONFLICT",
        "Another contact already uses that email address.",
      );
    }
    throw error;
  }
}

async function archiveContact(organizationId: string, id: string) {
  const found = await requireContact(organizationId, id);
  await ContactRepository.archive(organizationId, [id]);
  console.log("[contacts] archived", { organizationId, contactId: id });
  return { id, name: nameOf(found) };
}

async function restoreContact(organizationId: string, id: string) {
  let restored: Awaited<ReturnType<typeof ContactRepository.restore>>;
  try {
    restored = await ContactRepository.restore(organizationId, id);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(
        "CONFLICT",
        "A live contact already uses this contact's email address.",
      );
    }
    throw error;
  }
  // Not archived (or not the organization's): nothing to bring back.
  if (!restored) {
    return { id, name: nameOf(await requireContact(organizationId, id)) };
  }
  console.log("[contacts] restored", { organizationId, contactId: id });
  return { id, name: nameOf(restored) };
}

/** Deletes an archived contact forever (owners and admins only). */
async function purgeContact(organizationId: string, id: string) {
  const found = await requireContact(organizationId, id);
  if (!found.archivedAt) {
    throw new AppError(
      "CONFLICT",
      "Only an archived contact can be deleted forever. Archive them first.",
    );
  }
  const purged = await ArchiveService.purgeArchived(
    organizationId,
    "contact",
    [id],
    new Date().toISOString(),
  );
  if (purged.length === 0) {
    throw new AppError(
      "CONFLICT",
      "The contact was restored before they could be deleted.",
    );
  }
  console.log("[contacts] purged", {
    organizationId,
    contactId: id,
    suppressed: found.email !== null,
  });
  return { id, name: nameOf(found) };
}

/**
 * A person asked the agent to look at the contact again. True when it was
 * queued; false when the agent is already on it.
 */
async function enrichContact(organizationId: string, id: string) {
  const found = await requireContact(organizationId, id);
  const queued = await AgentTaskService.contactCreated(
    organizationId,
    id,
    found.linkedinUrl && !found.imageUrl
      ? "A person asked for a fresh look: they have a LinkedIn profile on file but no picture"
      : "A person asked for a fresh look",
    true,
  );
  if (queued) {
    await ContactRepository.markEnrichmentRequested(
      organizationId,
      id,
      found.updatedAt,
    );
  }
  return { id, queued };
}

async function bulkAssignOwner(
  organizationId: string,
  ids: string[],
  ownerId: string | null,
): Promise<BulkResult> {
  await assertOwner(organizationId, ownerId);
  const unique = [...new Set(ids)];
  const changed = await ContactRepository.setOwner(
    organizationId,
    unique,
    ownerId,
  );
  return bulkOutcome(unique.length, changed);
}

async function bulkSetCompany(
  organizationId: string,
  ids: string[],
  companyId: string | null,
): Promise<BulkResult> {
  if (companyId) await requireLiveCompany(organizationId, companyId);
  const unique = [...new Set(ids)];
  const moved = await ContactRelationsRepository.setCompany(
    organizationId,
    unique,
    companyId,
  );
  console.log("[contacts] moved", { organizationId, companyId, moved });
  return bulkOutcome(unique.length, moved);
}

async function bulkArchive(
  organizationId: string,
  ids: string[],
): Promise<BulkResult> {
  const unique = [...new Set(ids)];
  const archived = await ContactRepository.archive(organizationId, unique);
  return bulkOutcome(unique.length, archived.length);
}

function bulkEnrich(organizationId: string, ids: string[]) {
  return runBulk(ids, (id) => enrichContact(organizationId, id));
}

function bulkRestore(organizationId: string, ids: string[]) {
  return runBulk(ids, (id) => restoreContact(organizationId, id));
}

function bulkPurge(organizationId: string, ids: string[]) {
  return runBulk(ids, (id) => purgeContact(organizationId, id));
}

export const ContactService = {
  listContacts,
  getContact,
  createContact,
  updateContact,
  archiveContact,
  restoreContact,
  purgeContact,
  enrichContact,
  bulkAssignOwner,
  bulkSetCompany,
  bulkArchive,
  bulkEnrich,
  bulkRestore,
  bulkPurge,
};
