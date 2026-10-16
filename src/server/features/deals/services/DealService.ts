import { CompanyRepository } from "@/server/features/companies/repositories/CompanyRepository";
import { ConversionService } from "@/server/features/currency/services/ConversionService";
import { DealContactRepository } from "@/server/features/deals/repositories/DealContactRepository";
import { DealRepository } from "@/server/features/deals/repositories/DealRepository";
import {
  assertOwner,
  blankToNull,
  bulkOutcome,
  runBulk,
} from "@/server/features/records/recordRules";
import { AppError } from "@/server/lib/errors";
import { normalizeCurrency, roundMoney } from "@/shared/currency";
import { isClosedStage, isLosingStage } from "@/shared/deal-stages";
import type {
  AttachDealContactInput,
  CreateDealInput,
  DealListInput,
  SetDealStageInput,
  UpdateDealInput,
} from "@/types/schemas/deals";
import type { BulkResult } from "@/types/schemas/records";

// Deals: what is being sold to a company, by whom, for how much, and how
// far it has got. An amount is in its own currency, rounded to that
// currency's minor unit, with its value in the workspace's reporting
// currency frozen beside it whenever the amount or currency is saved
// (src/server/features/currency). Every stage change lands on the deal's
// timeline.

function notFound(id: string): never {
  throw new AppError("NOT_FOUND", `No deal with id ${id}.`);
}

async function requireDeal(organizationId: string, id: string) {
  return (await DealRepository.findById(organizationId, id)) ?? notFound(id);
}

/** Refuses a company that isn't the organization's. */
async function requireCompany(organizationId: string, companyId: string) {
  if (!(await CompanyRepository.findById(organizationId, companyId))) {
    throw new AppError("NOT_FOUND", `No company with id ${companyId}.`);
  }
}

/** A close date's day as stored: its UTC midnight. */
function closeDateOf(day: string | null | undefined): string | null {
  return day ? `${day}T00:00:00.000Z` : null;
}

/**
 * The list's page, with what the open deals in its view are worth in the
 * reporting currency and how many of them no rate converts yet.
 */
async function listDeals(organizationId: string, input: DealListInput) {
  const reportingCurrency =
    await ConversionService.reportingCurrency(organizationId);
  const [{ rows, total }, openValue, unconverted] = await Promise.all([
    DealRepository.list(organizationId, input),
    DealRepository.openValue(organizationId, input, reportingCurrency),
    ConversionService.unconverted(
      organizationId,
      DealRepository.openInView(organizationId, input),
    ),
  ]);
  return { rows, total, openValue, reportingCurrency, unconverted };
}

export type DealListRow = Awaited<ReturnType<typeof listDeals>>["rows"][number];

/** A deal with what its sheet shows: company, owner, the people on it. */
async function getDeal(organizationId: string, id: string) {
  const { organizationId: _, ...found } = await requireDeal(organizationId, id);
  const [contacts, reportingCurrency] = await Promise.all([
    DealContactRepository.listForDeal(organizationId, id),
    ConversionService.reportingCurrency(organizationId),
  ]);
  return { ...found, contacts, reportingCurrency };
}

export type DealDetail = Awaited<ReturnType<typeof getDeal>>;

async function createDeal(organizationId: string, input: CreateDealInput) {
  await requireCompany(organizationId, input.companyId);
  await assertOwner(organizationId, input.ownerId);
  const stage = input.stage ?? "DEMO_BOOKED";
  const currency =
    input.currency ??
    (await ConversionService.reportingCurrency(organizationId));
  const amount =
    input.amount == null ? null : roundMoney(input.amount, currency);
  const now = new Date().toISOString();
  const row = await DealRepository.insert({
    organizationId,
    name: input.name.trim(),
    companyId: input.companyId,
    ownerId: input.ownerId,
    stage,
    stageChangedAt: now,
    closedAt: isClosedStage(stage) ? now : null,
    amount,
    currency,
    ...(await ConversionService.dealFields(organizationId, amount, currency)),
    expectedCloseDate: closeDateOf(input.expectedCloseDate),
  });
  console.log("[deals] created", { organizationId, dealId: row.id, stage });
  return row;
}

type DealPatch = Parameters<typeof DealRepository.update>[2];

async function updateDeal(organizationId: string, input: UpdateDealInput) {
  const { id } = input;
  const patch: DealPatch = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.description !== undefined) {
    patch.description =
      input.description === null ? null : blankToNull(input.description);
  }
  if (input.companyId !== undefined) {
    await requireCompany(organizationId, input.companyId);
    patch.companyId = input.companyId;
  }
  if (input.ownerId !== undefined) {
    await assertOwner(organizationId, input.ownerId);
    patch.ownerId = input.ownerId;
  }
  if (input.expectedCloseDate !== undefined) {
    patch.expectedCloseDate = closeDateOf(input.expectedCloseDate);
  }
  if (input.amount !== undefined || input.currency !== undefined) {
    // The unchanged one of the two is read back, and the conversion frozen
    // again at today's rate.
    const current = await requireDeal(organizationId, id);
    const currency = input.currency ?? normalizeCurrency(current.currency);
    const amount = input.amount === undefined ? current.amount : input.amount;
    patch.currency = currency;
    patch.amount = amount === null ? null : roundMoney(amount, currency);
    Object.assign(
      patch,
      await ConversionService.dealFields(
        organizationId,
        patch.amount,
        currency,
      ),
    );
  }
  const updated = await DealRepository.update(organizationId, id, patch);
  if (!updated) notFound(id);
  return updated;
}

/**
 * Moves the deal to `stage`, for `movedById`. A deal already there is left
 * alone (`changed: false`); a lost or unqualified deal needs a reason.
 */
async function setStage(
  organizationId: string,
  input: SetDealStageInput,
  movedById: string,
) {
  const { id, stage } = input;
  const found = await requireDeal(organizationId, id);
  if (found.stage === stage) return { id, stage, changed: false };
  const reason = input.closedReason?.trim() || null;
  if (isLosingStage(stage) && !reason) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Say why it was lost: a closed-lost deal with no reason teaches nobody anything.",
    );
  }
  const moved = await DealRepository.moveStage(organizationId, {
    id,
    companyId: found.companyId,
    from: found.stage,
    to: stage,
    reason,
    movedById,
  });
  if (!moved) {
    // Someone moved it first: fine if they moved it here too.
    const now = await requireDeal(organizationId, id);
    if (now.stage === stage) return { id, stage, changed: false };
    throw new AppError(
      "CONFLICT",
      "Someone moved this deal to another stage meanwhile.",
    );
  }
  console.log("[deals] stage changed", {
    organizationId,
    dealId: id,
    from: found.stage,
    to: stage,
  });
  return { id, stage, changed: true };
}

async function archiveDeal(organizationId: string, id: string) {
  const found = await requireDeal(organizationId, id);
  await DealRepository.archive(organizationId, [id]);
  console.log("[deals] archived", { organizationId, dealId: id });
  return { id, name: found.name };
}

async function restoreDeal(organizationId: string, id: string) {
  const restored = await DealRepository.restore(organizationId, id);
  // Not archived (or not the organization's): nothing to bring back.
  if (!restored)
    return { id, name: (await requireDeal(organizationId, id)).name };
  console.log("[deals] restored", { organizationId, dealId: id });
  return restored;
}

/** Deletes an archived deal forever (owners and admins only). */
async function purgeDeal(organizationId: string, id: string) {
  const found = await requireDeal(organizationId, id);
  if (!found.archivedAt) {
    throw new AppError(
      "CONFLICT",
      "Only an archived deal can be deleted forever. Archive it first.",
    );
  }
  if (!(await DealRepository.purge(organizationId, id))) {
    throw new AppError(
      "CONFLICT",
      "The deal was restored before it could be deleted.",
    );
  }
  console.log("[deals] purged", { organizationId, dealId: id });
  return { id, name: found.name };
}

/** Who at the deal's company could be brought onto it. */
async function contactOptions(organizationId: string, dealId: string) {
  const found = await requireDeal(organizationId, dealId);
  return DealContactRepository.options(organizationId, dealId, found.companyId);
}

function roleOf(role: string | null | undefined): string | null {
  return role ? blankToNull(role) : null;
}

/** Brings someone who works at the deal's company onto the deal. */
async function attachContact(
  organizationId: string,
  input: AttachDealContactInput,
) {
  const found = await requireDeal(organizationId, input.dealId);
  const person = await DealContactRepository.findContact(
    organizationId,
    input.contactId,
  );
  if (!person) {
    throw new AppError("NOT_FOUND", `No contact with id ${input.contactId}.`);
  }
  if (person.companyId !== found.companyId) {
    throw new AppError(
      "VALIDATION_ERROR",
      `That contact does not work at ${found.company.name}.`,
    );
  }
  await DealContactRepository.attach(organizationId, {
    dealId: input.dealId,
    contactId: input.contactId,
    role: roleOf(input.role),
  });
  console.log("[deals] contact attached", {
    organizationId,
    dealId: input.dealId,
    contactId: input.contactId,
  });
  return { dealId: input.dealId, contactId: input.contactId };
}

async function detachContact(
  organizationId: string,
  dealId: string,
  contactId: string,
) {
  if (
    !(await DealContactRepository.detach(organizationId, dealId, contactId))
  ) {
    throw new AppError("NOT_FOUND", "That contact is not on this deal.");
  }
  console.log("[deals] contact detached", {
    organizationId,
    dealId,
    contactId,
  });
  return { dealId, contactId };
}

async function setContactRole(
  organizationId: string,
  input: { dealId: string; contactId: string; role: string | null },
) {
  const role = roleOf(input.role);
  if (
    !(await DealContactRepository.setRole(organizationId, { ...input, role }))
  ) {
    throw new AppError("NOT_FOUND", "That contact is not on this deal.");
  }
  return { dealId: input.dealId, contactId: input.contactId, role };
}

async function bulkAssignOwner(
  organizationId: string,
  ids: string[],
  ownerId: string,
): Promise<BulkResult> {
  await assertOwner(organizationId, ownerId);
  const unique = [...new Set(ids)];
  const changed = await DealRepository.setOwner(
    organizationId,
    unique,
    ownerId,
  );
  return bulkOutcome(unique.length, changed);
}

/** Moves each deal, each on its own timeline; one reason goes on them all. */
async function bulkSetStage(
  organizationId: string,
  input: {
    ids: string[];
    stage: SetDealStageInput["stage"];
    closedReason?: string;
  },
  movedById: string,
): Promise<BulkResult> {
  const closedReason = input.closedReason?.trim();
  if (isLosingStage(input.stage) && !closedReason) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Say why they were lost: a closed-lost deal with no reason teaches nobody anything.",
    );
  }
  return runBulk(input.ids, (id) =>
    setStage(
      organizationId,
      { id, stage: input.stage, closedReason },
      movedById,
    ),
  );
}

async function bulkArchive(
  organizationId: string,
  ids: string[],
): Promise<BulkResult> {
  const unique = [...new Set(ids)];
  const archived = await DealRepository.archive(organizationId, unique);
  return bulkOutcome(unique.length, archived.length);
}

function bulkRestore(organizationId: string, ids: string[]) {
  return runBulk(ids, (id) => restoreDeal(organizationId, id));
}

function bulkPurge(organizationId: string, ids: string[]) {
  return runBulk(ids, (id) => purgeDeal(organizationId, id));
}

export const DealService = {
  listDeals,
  getDeal,
  createDeal,
  updateDeal,
  setStage,
  archiveDeal,
  restoreDeal,
  purgeDeal,
  contactOptions,
  attachContact,
  detachContact,
  setContactRole,
  bulkAssignOwner,
  bulkSetStage,
  bulkArchive,
  bulkRestore,
  bulkPurge,
};
