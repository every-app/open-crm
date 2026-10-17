import { ConversionService } from "@/server/features/currency/services/ConversionService";
import { DealRepository } from "@/server/features/deals/repositories/DealRepository";
import { DealService } from "@/server/features/deals/services/DealService";
import { FieldValueRepository } from "@/server/features/fields/repositories/FieldValueRepository";
import { DEAL_STAGES, type DealStage } from "@/shared/crm-enums";
import { CURRENCY_CODES, roundMoney, toCurrencyCode } from "@/shared/currency";
import {
  DEAL_STAGE_LABELS,
  isClosedStage,
  isLosingStage,
} from "@/shared/deal-stages";
import { DEAL_NAME_MAX, MAX_DEAL_AMOUNT } from "@/types/schemas/deals";
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

// Deals from a CSV. A deal is the same one as a live deal of its name at its
// company. Its company is named by name or domain and added when the CRM
// doesn't have it yet; its owner is the member its owner cell names, or the
// person importing. Its amount is in its currency, or the workspace's
// reporting currency, converted as a deal saved by hand is.

const IMPORT_REASON = "Set by a CSV import";

const STAGE_WORDS = new Map<string, DealStage>([
  ...DEAL_STAGES.map((stage) => [stage.toLowerCase(), stage] as const),
  ...DEAL_STAGES.map(
    (stage) => [DEAL_STAGE_LABELS[stage].toLowerCase(), stage] as const,
  ),
  ["won", "CLOSED_WON"],
  ["lost", "CLOSED_LOST"],
]);

function stageOf(raw: string | null): DealStage | null {
  if (!raw) return null;
  const stage =
    STAGE_WORDS.get(raw.toLowerCase().replace(/[\s-]+/g, "_")) ??
    STAGE_WORDS.get(raw.toLowerCase());
  if (!stage) {
    throw new RowError(
      `"${raw}" is not a stage. Use one of: ${DEAL_STAGES.map((value) => DEAL_STAGE_LABELS[value]).join(", ")}.`,
    );
  }
  return stage;
}

/** "$12,500.00" → 12500; a symbol or code around the number is dropped. */
function amountOf(raw: string | null): number | null {
  if (!raw) return null;
  const number = raw.replace(/[^\d.-]/g, "");
  const amount = Number(number);
  if (!/^-?\d*\.?\d+$/.test(number) || !Number.isFinite(amount)) {
    throw new RowError(`"${raw}" is not an amount.`);
  }
  if (amount < 0) throw new RowError("An amount can't be negative.");
  if (amount > MAX_DEAL_AMOUNT) {
    throw new RowError("That amount is too large to record.");
  }
  return amount;
}

/** A calendar day, written 2027-03-31 (a time after it is dropped). */
function closeDayOf(raw: string | null): string | null {
  if (!raw) return null;
  const day = raw.slice(0, 10);
  const parsed = new Date(`${day}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== day
  ) {
    throw new RowError(`"${raw}" is not a day. Write it like 2027-03-31.`);
  }
  return day;
}

function parseDeal(run: ImportRun, values: Record<string, string>) {
  const name = textCell(values, "name", "The name", DEAL_NAME_MAX);
  if (!name) throw new RowError("A deal needs a name.");
  const company = companyRefOf(cell(values, "company"));
  if (!company) throw new RowError("A deal needs a company.");
  const rawCurrency = cell(values, "currency");
  const currency = rawCurrency ? toCurrencyCode(rawCurrency) : null;
  if (rawCurrency && !currency) {
    throw new RowError(
      `"${rawCurrency}" is not a currency the CRM keeps. Use one of: ${CURRENCY_CODES.join(", ")}.`,
    );
  }
  return {
    name,
    company,
    stage: stageOf(cell(values, "stage")),
    amount: amountOf(cell(values, "amount")),
    currency,
    closeDay: closeDayOf(cell(values, "closeDate")),
    ownerId: memberOf(run, cell(values, "owner")),
    description: textCell(values, "description", "The description", 5000),
    writes: customValues(run, values),
  };
}

export async function importDeals(
  run: ImportRun,
  rows: ImportRow[],
): Promise<RowResult[]> {
  const parsed = parseRows(run, rows, (values) => parseDeal(run, values));
  const valid = parsed.flatMap((row) => ("ok" in row ? [row.value] : []));
  const [named, companyOf, reportingCurrency] = await Promise.all([
    ImportRepository.dealsByName(
      run.organizationId,
      valid.map((row) => row.name.toLowerCase()),
    ),
    companyResolver(
      run,
      valid.map((row) => row.company),
    ),
    ConversionService.reportingCurrency(run.organizationId),
  ]);
  // The deal each name at each company already is; null for one a dry run
  // would add.
  const existing = new Map<string, string | null>(
    named.map((row) => [`${row.companyId}|${row.name.toLowerCase()}`, row.id]),
  );

  const results: RowResult[] = [];
  for (const row of parsed) {
    if (!("ok" in row)) {
      results.push(row);
      continue;
    }
    const found = row.value;
    results.push(
      await saveRow(row.line, async () => {
        const companyId = await companyOf(found.company);
        const key = `${companyId ?? `new:${JSON.stringify(found.company)}`}|${found.name.toLowerCase()}`;
        if (existing.has(key)) {
          if (run.duplicates === "skip") return "skipped";
          const id = existing.get(key);
          if (run.dryRun || !id) return "updated";
          await DealService.updateDeal(run.organizationId, {
            id,
            ...(found.description ? { description: found.description } : {}),
            ...(found.amount !== null ? { amount: found.amount } : {}),
            ...(found.currency ? { currency: found.currency } : {}),
            ...(found.closeDay ? { expectedCloseDate: found.closeDay } : {}),
            ...(found.ownerId ? { ownerId: found.ownerId } : {}),
          });
          if (found.stage) {
            await DealService.setStage(
              run.organizationId,
              {
                id,
                stage: found.stage,
                closedReason: isLosingStage(found.stage)
                  ? IMPORT_REASON
                  : undefined,
              },
              run.userId,
            );
          }
          await FieldValueRepository.write(
            run.organizationId,
            "DEAL",
            id,
            found.writes,
          );
          return "updated";
        }
        if (run.dryRun || !companyId) {
          existing.set(key, null);
          return "created";
        }
        const stage = found.stage ?? "DEMO_BOOKED";
        const currency = found.currency ?? reportingCurrency;
        const amount =
          found.amount === null ? null : roundMoney(found.amount, currency);
        const now = new Date().toISOString();
        const inserted = await DealRepository.insert({
          organizationId: run.organizationId,
          name: found.name,
          description: found.description,
          companyId,
          ownerId: found.ownerId ?? run.userId,
          stage,
          stageChangedAt: now,
          closedAt: isClosedStage(stage) ? now : null,
          closedReason: isLosingStage(stage) ? IMPORT_REASON : null,
          amount,
          currency,
          ...(await ConversionService.dealFields(
            run.organizationId,
            amount,
            currency,
          )),
          expectedCloseDate: found.closeDay
            ? `${found.closeDay}T00:00:00.000Z`
            : null,
          source: "IMPORT",
        });
        existing.set(key, inserted.id);
        run.created.DEAL.push(inserted.id);
        await FieldValueRepository.write(
          run.organizationId,
          "DEAL",
          inserted.id,
          found.writes,
        );
        return "created";
      }),
    );
  }
  return results;
}
