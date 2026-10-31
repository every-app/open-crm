import { z } from "zod";
import {
  ListService,
  type ListSummary,
} from "@/server/features/lists/services/ListService";
import { CompanyDirectoryRepository } from "@/server/features/companies/repositories/CompanyDirectoryRepository";
import { ContactRepository } from "@/server/features/contacts/repositories/ContactRepository";
import { AppError } from "@/server/lib/errors";
import type { ListEntity } from "@/shared/crm-enums";
import { normalizeDomain, normalizeEmail } from "@/shared/domain";
import { LIST_COLORS, LIST_IDS_MAX } from "@/types/schemas/lists";
import { FACET_FILTER_MAX, NO_STAGE } from "@/types/schemas/records";

// Lists (record_list) as the tools take and show them: the contacts and
// companies tools' list filters and chips, a list's stage by id or by name,
// and its records by id, contacts by email and companies by domain, always
// looked up within the caller's organization.

const ENTITY_NAMES = { CONTACT: "contacts", COMPANY: "companies" } as const;

/** The list `id`, refused unless it holds `entity` (when given). */
export async function listOf(
  organizationId: string,
  id: string,
  entity?: ListEntity,
): Promise<ListSummary> {
  const list = await ListService.getList(organizationId, id);
  if (entity && list.entity !== entity) {
    throw new AppError(
      "VALIDATION_ERROR",
      `${list.name} holds ${ENTITY_NAMES[list.entity]}, not ${ENTITY_NAMES[entity]}.`,
    );
  }
  return list;
}

/** The id of the list's stage named `value` (its id, or its name in any case). */
export function stageId(list: ListSummary, value: string): string {
  const wanted = value.trim().toLowerCase();
  const stage = list.stages.find(
    (candidate) =>
      candidate.id === value.trim() || candidate.name.toLowerCase() === wanted,
  );
  if (!stage) {
    const names = list.stages.map((candidate) => candidate.name).join(", ");
    throw new AppError(
      "VALIDATION_ERROR",
      `${list.name} has no stage "${value}". ${names ? `Its stages: ${names}.` : "It has no stages."}`,
    );
  }
  return stage.id;
}

/** A stage filter's values as ids, `NO_STAGE` kept for records at none. */
export function stageFilter(list: ListSummary, values: string[]): string[] {
  return values.map((value) =>
    value.trim().toLowerCase() === NO_STAGE ? NO_STAGE : stageId(list, value),
  );
}

export const listStagesInput = z
  .array(z.string().trim().min(1).max(64))
  .max(FACET_FILTER_MAX)
  .optional();

/** The list filters list_contacts and list_companies take. */
export const listFilterInput = {
  list: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe("Only records in this list, by id (list_lists)."),
  listStages: listStagesInput.describe(
    `With list: only those at these stages, by id or name; "${NO_STAGE}" for those at no stage.`,
  ),
  due: z
    .boolean()
    .optional()
    .describe(
      "With list: only those Due, quiet longer than the list's follow-up days at an open stage.",
    ),
};

/** The list filters as the contacts or companies list input takes them. */
export async function listFilters(
  organizationId: string,
  entity: ListEntity,
  input: { list?: string; listStages?: string[]; due?: boolean },
) {
  if (!input.list) {
    if (input.listStages?.length || input.due) {
      throw new AppError(
        "VALIDATION_ERROR",
        "listStages and due filter within a list: give its id as list.",
      );
    }
    return {};
  }
  const list = await listOf(organizationId, input.list, entity);
  return {
    list: list.id,
    listStage: stageFilter(list, input.listStages ?? []),
    due: input.due,
  };
}

/** A row's lists, as the contacts and companies lists show them. */
export const listChipsOutput = z
  .array(
    z.object({
      id: z.string(),
      name: z.string(),
      color: z.enum(LIST_COLORS),
      stage: z.string().nullable().describe("Its stage there, by name."),
      due: z.boolean(),
    }),
  )
  .describe("The lists it is in.");

/** A record's lists, as get_contact and get_company show them. */
export const recordListsOutput = z
  .array(
    z.object({
      id: z.string(),
      name: z.string(),
      stage: z.object({ id: z.string(), name: z.string() }).nullable(),
      due: z
        .boolean()
        .describe(
          "Quiet longer than the list's follow-up days at an open stage.",
        ),
      addedAt: z.string(),
    }),
  )
  .describe("The lists it is in, with its stage in each.");

/** A record's lists for its recordListsOutput. */
export async function recordLists(
  organizationId: string,
  entity: ListEntity,
  id: string,
): Promise<z.input<typeof recordListsOutput>> {
  const memberships = await ListService.recordLists(organizationId, entity, id);
  return memberships.map((membership) => ({
    ...membership,
    id: membership.list.id,
    name: membership.list.name,
  }));
}

/** The records a tool takes: by id, contacts by email, companies by domain. */
export const recordsInput = {
  ids: z
    .array(z.string().min(1).max(64))
    .max(LIST_IDS_MAX)
    .optional()
    .describe(
      "Contact or company ids, as the list holds (list_contacts, list_companies, search_records).",
    ),
  emails: z
    .array(z.string().trim().min(1).max(320))
    .max(LIST_IDS_MAX)
    .optional()
    .describe("Contacts by email, for a list of contacts."),
  domains: z
    .array(z.string().trim().min(1).max(253))
    .max(LIST_IDS_MAX)
    .optional()
    .describe("Companies by domain, for a list of companies."),
};

type RecordsInput = { ids?: string[]; emails?: string[]; domains?: string[] };

export const unmatchedOutput = z
  .array(z.string())
  .describe("The emails or domains no live record of this CRM has.");

/**
 * The list's records named by id, email or domain, the emails and domains
 * looked up in the caller's organization only, and those that matched none.
 */
export async function recordIds(
  organizationId: string,
  list: ListSummary,
  input: RecordsInput,
) {
  const emails = input.emails ?? [];
  const domains = input.domains ?? [];
  if (emails.length > 0 && list.entity !== "CONTACT") {
    throw new AppError(
      "VALIDATION_ERROR",
      `${list.name} holds companies: name them by id or domain.`,
    );
  }
  if (domains.length > 0 && list.entity !== "COMPANY") {
    throw new AppError(
      "VALIDATION_ERROR",
      `${list.name} holds contacts: name them by id or email.`,
    );
  }
  const found = await Promise.all([
    ...emails.map(async (email) => {
      const normalized = normalizeEmail(email);
      const row =
        normalized &&
        (await ContactRepository.findLiveByEmail(organizationId, normalized));
      return { value: email, id: row ? row.id : null };
    }),
    ...domains.map(async (domain) => {
      const normalized = normalizeDomain(domain);
      const row =
        normalized &&
        (await CompanyDirectoryRepository.findLive(organizationId, normalized));
      return { value: domain, id: row ? row.id : null };
    }),
  ]);
  const ids = [
    ...new Set([
      ...(input.ids ?? []),
      ...found.flatMap((match) => (match.id ? [match.id] : [])),
    ]),
  ];
  const unmatched = found.flatMap((match) => (match.id ? [] : [match.value]));
  if (ids.length === 0 && unmatched.length === 0) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Name the records: ids, emails or domains.",
    );
  }
  if (ids.length > LIST_IDS_MAX) {
    throw new AppError(
      "VALIDATION_ERROR",
      `At most ${LIST_IDS_MAX} records at once.`,
    );
  }
  return { ids, unmatched };
}
