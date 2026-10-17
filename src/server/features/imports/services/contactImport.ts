import { ContactRepository } from "@/server/features/contacts/repositories/ContactRepository";
import { ContactService } from "@/server/features/contacts/services/ContactService";
import { FieldValueRepository } from "@/server/features/fields/repositories/FieldValueRepository";
import { isUniqueViolation } from "@/server/features/records/recordRules";
import { normalizeEmail } from "@/shared/domain";
import {
  CONTACT_EMAIL_MAX,
  CONTACT_NAME_MAX,
  CONTACT_TITLE_MAX,
} from "@/types/schemas/contacts";
import { ImportRepository } from "../repositories/ImportRepository";
import {
  cell,
  companyRefOf,
  companyResolver,
  customValues,
  memberOf,
  parseRows,
  RowError,
  saveRow,
  textCell,
  type ImportRow,
  type ImportRun,
  type RowResult,
} from "./importRun";

// Contacts from a CSV. A contact is the same one as a live contact with its
// email; one with no email is the same as a live contact of its name at its
// company. Each works at the company its company cell names (by name or
// domain), or else at the one behind its work email, which is added when
// the CRM doesn't have it yet.

function parseContact(run: ImportRun, values: Record<string, string>) {
  const fullName = textCell(values, "fullName", "The name", 2 * CONTACT_NAME_MAX);
  const [first, ...rest] = fullName?.split(/\s+/) ?? [];
  const firstName =
    textCell(values, "firstName", "The first name", CONTACT_NAME_MAX) ??
    first ??
    null;
  if (!firstName) {
    throw new RowError("A contact needs a first name, or a full name.");
  }
  if (firstName.length > CONTACT_NAME_MAX) {
    throw new RowError(
      `The first name is longer than ${CONTACT_NAME_MAX} characters.`,
    );
  }
  const lastName =
    textCell(values, "lastName", "The last name", CONTACT_NAME_MAX) ??
    (cell(values, "firstName") ? null : rest.join(" ") || null);
  if (lastName && lastName.length > CONTACT_NAME_MAX) {
    throw new RowError(
      `The last name is longer than ${CONTACT_NAME_MAX} characters.`,
    );
  }
  const rawEmail = textCell(values, "email", "The email", CONTACT_EMAIL_MAX);
  const email = rawEmail ? normalizeEmail(rawEmail) : null;
  if (rawEmail && !email) {
    throw new RowError(`"${rawEmail}" is not an email address.`);
  }
  return {
    firstName,
    lastName,
    email,
    phone: textCell(values, "phone", "The phone", 100),
    title: textCell(values, "title", "The job title", CONTACT_TITLE_MAX),
    linkedinUrl: textCell(values, "linkedinUrl", "LinkedIn", 2048),
    company: companyRefOf(cell(values, "company"), email),
    ownerId: memberOf(run, cell(values, "owner")),
    writes: customValues(run, values),
  };
}

/** A contact with no email: the same person is the same name at the same company. */
function nameKey(
  firstName: string,
  lastName: string | null,
  companyId: string | null,
): string {
  return `${firstName.toLowerCase()}|${(lastName ?? "").toLowerCase()}|${companyId ?? ""}`;
}

export async function importContacts(
  run: ImportRun,
  rows: ImportRow[],
): Promise<RowResult[]> {
  const parsed = parseRows(run, rows, (values) => parseContact(run, values));
  const valid = parsed.flatMap((row) => ("ok" in row ? [row.value] : []));
  const [withEmail, withoutEmail, companyOf] = await Promise.all([
    ImportRepository.contactsByEmail(
      run.organizationId,
      valid.flatMap((row) => (row.email ? [row.email] : [])),
    ),
    ImportRepository.contactsByFirstName(
      run.organizationId,
      valid.flatMap((row) => (row.email ? [] : [row.firstName.toLowerCase()])),
    ),
    companyResolver(
      run,
      valid.flatMap((row) => (row.company ? [row.company] : [])),
    ),
  ]);
  // The contact each key already is; null for one a dry run would add.
  const existing = new Map<string, string | null>();
  for (const row of withEmail) existing.set(`email:${row.email}`, row.id);
  for (const row of withoutEmail) {
    existing.set(
      `name:${nameKey(row.firstName, row.lastName, row.companyId)}`,
      row.id,
    );
  }

  const results: RowResult[] = [];
  for (const row of parsed) {
    if (!("ok" in row)) {
      results.push(row);
      continue;
    }
    const person = row.value;
    results.push(
      await saveRow(row.line, async () => {
        const companyId = person.company
          ? await companyOf(person.company)
          : null;
        const key = person.email
          ? `email:${person.email}`
          : `name:${nameKey(person.firstName, person.lastName, companyId)}`;
        if (existing.has(key)) {
          if (run.duplicates === "skip") return "skipped";
          const id = existing.get(key);
          if (run.dryRun || !id) return "updated";
          await ContactService.updateContact(run.organizationId, {
            id,
            firstName: person.firstName,
            ...(person.lastName ? { lastName: person.lastName } : {}),
            ...(person.phone ? { phone: person.phone } : {}),
            ...(person.title ? { title: person.title } : {}),
            ...(person.linkedinUrl ? { linkedinUrl: person.linkedinUrl } : {}),
            ...(companyId ? { companyId } : {}),
            ...(person.ownerId ? { ownerId: person.ownerId } : {}),
          });
          await FieldValueRepository.write(
            run.organizationId,
            "CONTACT",
            id,
            person.writes,
          );
          return "updated";
        }
        if (run.dryRun) {
          existing.set(key, null);
          return "created";
        }
        let id: string;
        try {
          id = await ContactRepository.insert({
            organizationId: run.organizationId,
            firstName: person.firstName,
            lastName: person.lastName,
            email: person.email,
            phone: person.phone,
            title: person.title,
            linkedinUrl: person.linkedinUrl,
            companyId,
            ownerId: person.ownerId,
            source: "IMPORT",
          });
        } catch (error) {
          // Another request added the email first: it's a duplicate.
          if (isUniqueViolation(error)) return "skipped";
          throw error;
        }
        existing.set(key, id);
        run.created.CONTACT.push(id);
        await FieldValueRepository.write(
          run.organizationId,
          "CONTACT",
          id,
          person.writes,
        );
        return "created";
      }),
    );
  }
  return results;
}
