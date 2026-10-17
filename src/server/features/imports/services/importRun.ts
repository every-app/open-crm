import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import { CompanyRepository } from "@/server/features/companies/repositories/CompanyRepository";
import {
  FieldDefinitionRepository,
  type FieldDefinitionWithOptions,
} from "@/server/features/fields/repositories/FieldDefinitionRepository";
import type { FieldWrite } from "@/server/features/fields/repositories/FieldValueRepository";
import { asAppError } from "@/server/lib/errors";
import type { FieldEntity } from "@/shared/crm-enums";
import { domainFromEmail, normalizeDomain } from "@/shared/domain";
import { parseFieldValue } from "@/shared/fields";
import {
  CUSTOM_FIELD_TARGET,
  IMPORT_TARGETS,
  type ImportDuplicates,
  type ImportOutcome,
} from "@/shared/imports";
import { COMPANY_NAME_MAX } from "@/types/schemas/companies";
import { ImportRepository } from "../repositories/ImportRepository";

// What every kind of CSV import shares: one chunk's run (who imports, what
// happens to duplicates, the workspace's members and custom fields), reading
// a row's cells, owners, custom field values, and the companies contacts and
// deals belong to.

/** A row that can't be imported, and why, in words for the report. */
export class RowError extends Error {}

export type RowResult = { line: number; outcome: ImportOutcome; error?: string };

export type ImportRow = { line: number; values: Record<string, string> };

export type ImportRun = {
  organizationId: string;
  userId: string;
  entity: FieldEntity;
  duplicates: ImportDuplicates;
  dryRun: boolean;
  members: { userId: string; name: string; email: string }[];
  /** The live custom fields of the entity being imported. */
  fields: FieldDefinitionWithOptions[];
  /** Records this chunk created, by kind, for the research agent. */
  created: Record<FieldEntity, string[]>;
};

export async function openRun(input: {
  organizationId: string;
  userId: string;
  entity: FieldEntity;
  duplicates: ImportDuplicates;
  dryRun: boolean;
}): Promise<ImportRun> {
  const [members, fields] = await Promise.all([
    AuthRepository.listMembers(input.organizationId),
    FieldDefinitionRepository.list(input.organizationId, input.entity, {
      includeArchived: false,
    }),
  ]);
  return {
    ...input,
    members,
    fields,
    created: { COMPANY: [], CONTACT: [], DEAL: [] },
  };
}

/**
 * Each row parsed by `parse`, or the reason it can't be: a row's own
 * problems never stop the others.
 */
export function parseRows<T>(
  run: ImportRun,
  rows: ImportRow[],
  parse: (values: Record<string, string>) => T,
): ({ line: number; ok: true; value: T } | RowResult)[] {
  const known = new Set<string>(
    IMPORT_TARGETS[run.entity].map((target) => target.id),
  );
  return rows.map((row) => {
    try {
      for (const target of Object.keys(row.values)) {
        if (!known.has(target) && !target.startsWith(CUSTOM_FIELD_TARGET)) {
          throw new RowError(`There is no field "${target}" to import into.`);
        }
      }
      return { line: row.line, ok: true as const, value: parse(row.values) };
    } catch (error) {
      if (error instanceof RowError) {
        return { line: row.line, outcome: "failed", error: error.message };
      }
      throw error;
    }
  });
}

/** Runs one row's writes; a failure fails that row, never the chunk. */
export async function saveRow(
  line: number,
  save: () => Promise<ImportOutcome>,
): Promise<RowResult> {
  try {
    return { line, outcome: await save() };
  } catch (error) {
    if (error instanceof RowError) {
      return { line, outcome: "failed", error: error.message };
    }
    // A validation or conflict message is written for people; anything else
    // stays in the logs.
    const appError = asAppError(error);
    if (appError?.code === "VALIDATION_ERROR" || appError?.code === "CONFLICT") {
      return { line, outcome: "failed", error: appError.message };
    }
    console.error("[import] row failed", { line }, error);
    return { line, outcome: "failed", error: "This row could not be saved." };
  }
}

/** The cell's trimmed text, or null for a blank or unmapped one. */
export function cell(
  values: Record<string, string>,
  target: string,
): string | null {
  const value = values[target]?.trim();
  return value ? value : null;
}

/** A text cell, refused when longer than its field holds. */
export function textCell(
  values: Record<string, string>,
  target: string,
  label: string,
  max: number,
): string | null {
  const value = cell(values, target);
  if (value && value.length > max) {
    throw new RowError(`${label} is longer than ${max} characters.`);
  }
  return value;
}

/** The member a cell names, by email or name; null for a blank cell. */
export function memberOf(run: ImportRun, raw: string | null): string | null {
  if (!raw) return null;
  const wanted = raw.toLowerCase();
  const found =
    run.members.find((member) => member.email.toLowerCase() === wanted) ??
    run.members.find((member) => member.name.toLowerCase() === wanted);
  if (!found) {
    throw new RowError(`Nobody in this workspace is called "${raw}".`);
  }
  return found.userId;
}

/** The row's custom field values, each checked against its field. */
export function customValues(
  run: ImportRun,
  values: Record<string, string>,
): FieldWrite[] {
  const writes: FieldWrite[] = [];
  for (const [target, raw] of Object.entries(values)) {
    if (!target.startsWith(CUSTOM_FIELD_TARGET) || !raw.trim()) continue;
    const key = target.slice(CUSTOM_FIELD_TARGET.length);
    const definition = run.fields.find((field) => field.key === key);
    if (!definition) {
      throw new RowError(`There is no custom field "${key}".`);
    }
    const input =
      definition.type === "USER" ? memberOf(run, raw.trim()) : raw.trim();
    const parsed = parseFieldValue(
      {
        ...definition,
        options: definition.options.map((option) => ({
          id: option.id,
          label: option.label,
          archived: option.archivedAt !== null,
        })),
      },
      input,
    );
    if (!parsed.ok) throw new RowError(parsed.message);
    writes.push({
      fieldId: definition.id,
      type: definition.type,
      value: parsed.value,
    });
  }
  return writes;
}

/** A company a contact or deal names: by name, by domain, or both. */
export type CompanyRef = { name: string | null; domain: string | null };

/**
 * The company a row names: a company cell holding a domain is that domain;
 * one holding a name is that name, at the work email's domain when there is
 * one. With no company cell, a work email's domain. Null for none.
 */
export function companyRefOf(
  raw: string | null,
  email: string | null = null,
): CompanyRef | null {
  const emailDomain = domainFromEmail(email);
  if (raw) {
    const domain = /\s/.test(raw) ? null : normalizeDomain(raw);
    if (domain && raw.includes(".")) return { name: null, domain };
    if (raw.length > COMPANY_NAME_MAX) {
      throw new RowError(
        `The company is longer than ${COMPANY_NAME_MAX} characters.`,
      );
    }
    return { name: raw, domain: emailDomain };
  }
  return emailDomain ? { name: null, domain: emailDomain } : null;
}

/**
 * Finds the live company each ref names (by domain first, then by name) and
 * adds the ones that don't exist yet, once each, as imported companies. In
 * a dry run nothing is added: a new company has no id yet.
 */
export async function companyResolver(run: ImportRun, refs: CompanyRef[]) {
  const domains = refs.flatMap((ref) => (ref.domain ? [ref.domain] : []));
  const names = refs.flatMap((ref) =>
    ref.name ? [ref.name.toLowerCase()] : [],
  );
  const [withDomain, withName] = await Promise.all([
    ImportRepository.companiesByDomain(run.organizationId, domains),
    ImportRepository.companiesByName(run.organizationId, names),
  ]);
  const byDomain = new Map<string, string | null>();
  const byName = new Map<string, string | null>();
  for (const row of withName) byName.set(row.name.toLowerCase(), row.id);
  for (const row of withDomain) if (row.domain) byDomain.set(row.domain, row.id);

  const remember = (ref: CompanyRef, id: string | null) => {
    if (ref.domain) byDomain.set(ref.domain, id);
    if (ref.name) byName.set(ref.name.toLowerCase(), id);
  };

  /** The company's id: null only in a dry run, for one not added yet. */
  return async (ref: CompanyRef): Promise<string | null> => {
    if (ref.domain && byDomain.has(ref.domain)) {
      return byDomain.get(ref.domain) ?? null;
    }
    if (ref.name && byName.has(ref.name.toLowerCase())) {
      return byName.get(ref.name.toLowerCase()) ?? null;
    }
    if (run.dryRun) {
      remember(ref, null);
      return null;
    }
    const name = ref.name ?? ref.domain ?? "";
    const row = await CompanyRepository.insert({
      organizationId: run.organizationId,
      name,
      domain: ref.domain,
      website: ref.domain ? `https://${ref.domain}` : null,
      ownerId: null,
      source: "IMPORT",
    });
    if (row.created) run.created.COMPANY.push(row.id);
    remember(ref, row.id);
    return row.id;
  };
}
