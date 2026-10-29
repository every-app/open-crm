import { ArchiveService } from "@/server/features/archive/services/ArchiveService";
import { CompanyDirectoryService } from "@/server/features/companies/services/CompanyDirectoryService";
import { ContactRelationsRepository } from "@/server/features/contacts/repositories/ContactRelationsRepository";
import { ContactRepository } from "@/server/features/contacts/repositories/ContactRepository";
import { FieldValuesService } from "@/server/features/fields/services/FieldValuesService";
import {
  assertOwner,
  blankToNull,
  bulkOutcome,
  fieldWrites,
  isUniqueViolation,
  runBulk,
} from "@/server/features/records/recordRules";
import { AppError, UserFacingError } from "@/server/lib/errors";
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
// filed under the company behind its work email.

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
 * the rest, each row with its values for the fields shown as columns; and
 * how many contacts its search finds have each value of its filters.
 */
async function listContacts(organizationId: string, input: ContactListInput) {
  const fieldConditions = await FieldValuesService.filterConditions(
    organizationId,
    "CONTACT",
    input.fields,
  );
  const [{ rows, total }, facetCounts, fieldFacetCounts] = await Promise.all([
    ContactRepository.list(organizationId, input, fieldConditions),
    ContactRepository.facetCounts(organizationId, input),
    FieldValuesService.facetCounts(
      organizationId,
      "CONTACT",
      ContactRepository.idsInScope(organizationId, input),
    ),
  ]);
  const ids = rows.map((row) => row.id);
  const fields = await FieldValuesService.tableValues(
    organizationId,
    "CONTACT",
    ids,
  );
  return {
    rows: rows.map((row) => ({
      ...row,
      fields: fields[row.id] ?? {},
    })),
    total,
    facetCounts: { ...facetCounts, ...fieldFacetCounts },
  };
}

export type ContactListRow = Awaited<
  ReturnType<typeof listContacts>
>["rows"][number];

/**
 * A contact with what its sheet shows: owner, company, the deals they're on,
 * and the colleagues and mail around them.
 */
async function getContact(organizationId: string, id: string) {
  const { organizationId: _, ...found } = await requireContact(
    organizationId,
    id,
  );
  const [deals, colleagues, relationship] = await Promise.all([
    ContactRelationsRepository.listDeals(organizationId, id),
    found.companyId
      ? ContactRelationsRepository.listColleagues(
          organizationId,
          id,
          found.companyId,
        )
      : [],
    ContactRelationsRepository.relationship(organizationId, id),
  ]);
  return {
    ...found,
    isPrimaryContact: found.company?.primaryContactId === id,
    deals,
    relationship: {
      ...relationship,
      colleagues: colleagues.map((colleague) => ({
        id: colleague.id,
        name: nameOf(colleague),
        title: colleague.title,
      })),
    },
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
  const fields = await fieldWrites(organizationId, "CONTACT", input.fields);
  if (email) {
    const existing = await ContactRepository.findLiveByEmail(
      organizationId,
      email,
    );
    if (existing) {
      throw new UserFacingError(
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
      ? await CompanyDirectoryService.companyForEmail(
          organizationId,
          email,
          ownerId,
        )
      : null);
  const firstName = input.firstName.trim();
  const lastName = blankToNull(input.lastName ?? "");
  let id: string;
  try {
    id = await ContactRepository.insert(
      {
        organizationId,
        firstName,
        lastName,
        email,
        phone: blankToNull(input.phone ?? ""),
        title: blankToNull(input.title ?? ""),
        companyId,
        ownerId,
      },
      fields,
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new UserFacingError(
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
  const fields = await fieldWrites(organizationId, "CONTACT", input.fields, id);
  await requireContact(organizationId, id);
  try {
    return (
      (await ContactRepository.update(organizationId, id, patch, fields)) ??
      notFound(id)
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new UserFacingError(
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
      throw new UserFacingError(
        "CONFLICT",
        "A live contact already uses this contact's email address. Change or archive that one first.",
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
    throw new UserFacingError(
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
    throw new UserFacingError(
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
  bulkAssignOwner,
  bulkSetCompany,
  bulkArchive,
  bulkRestore,
  bulkPurge,
};
