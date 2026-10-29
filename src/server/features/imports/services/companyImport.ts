import { CompanyRepository } from "@/server/features/companies/repositories/CompanyRepository";
import { CompanyService } from "@/server/features/companies/services/CompanyService";
import { FieldValueRepository } from "@/server/features/fields/repositories/FieldValueRepository";
import { normalizeDomain } from "@/shared/domain";
import { COMPANY_NAME_MAX } from "@/types/schemas/companies";
import { ImportRepository } from "../repositories/ImportRepository";
import {
  cell,
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

// Companies from a CSV. A company is the same one as a live company with
// its domain; one with no domain is the same as a live company of its name.

const DETAILS = [
  ["industry", "Industry", 200],
  ["description", "Description", 5000],
  ["phone", "Phone", 100],
  ["email", "Email", 320],
  ["city", "City", 200],
  ["stateCode", "State", 100],
  ["country", "Country", 200],
  ["linkedinUrl", "LinkedIn", 2048],
] as const;

type Detail = (typeof DETAILS)[number][0];

function parseCompany(run: ImportRun, values: Record<string, string>) {
  const name = textCell(values, "name", "The name", COMPANY_NAME_MAX);
  if (!name) throw new RowError("A company needs a name.");
  const rawDomain = cell(values, "domain");
  const domain = rawDomain ? normalizeDomain(rawDomain) : null;
  if (rawDomain && !domain) {
    throw new RowError(
      `"${rawDomain}" is not a domain. Try one like acme.com.`,
    );
  }
  const details: Partial<Record<Detail, string>> = {};
  for (const [key, label, max] of DETAILS) {
    const value = textCell(values, key, label, max);
    if (value) details[key] = value;
  }
  return {
    name,
    domain,
    details,
    ownerId: memberOf(run, cell(values, "owner")),
    writes: customValues(run, values),
  };
}

export async function importCompanies(
  run: ImportRun,
  rows: ImportRow[],
): Promise<RowResult[]> {
  const parsed = parseRows(run, rows, (values) => parseCompany(run, values));
  const valid = parsed.flatMap((row) => ("ok" in row ? [row.value] : []));
  const [withDomain, withName] = await Promise.all([
    ImportRepository.companiesByDomain(
      run.organizationId,
      valid.flatMap((row) => (row.domain ? [row.domain] : [])),
    ),
    ImportRepository.companiesByName(
      run.organizationId,
      valid.flatMap((row) => (row.domain ? [] : [row.name.toLowerCase()])),
    ),
  ]);
  // The company each key already is; null for one a dry run would add.
  const existing = new Map<string, string | null>();
  for (const row of withName)
    existing.set(`name:${row.name.toLowerCase()}`, row.id);
  for (const row of withDomain) existing.set(`domain:${row.domain}`, row.id);

  const results: RowResult[] = [];
  for (const row of parsed) {
    if (!("ok" in row)) {
      results.push(row);
      continue;
    }
    const company = row.value;
    const key = company.domain
      ? `domain:${company.domain}`
      : `name:${company.name.toLowerCase()}`;
    results.push(
      await saveRow(row.line, async () => {
        if (existing.has(key)) {
          if (run.duplicates === "skip") return "skipped";
          const id = existing.get(key);
          if (run.dryRun || !id) return "updated";
          await CompanyService.updateCompany(run.organizationId, {
            id,
            name: company.name,
            ...company.details,
            ...(company.ownerId ? { ownerId: company.ownerId } : {}),
          });
          await FieldValueRepository.write(
            run.organizationId,
            "COMPANY",
            id,
            company.writes,
          );
          return "updated";
        }
        if (run.dryRun) {
          existing.set(key, null);
          return "created";
        }
        const inserted = await CompanyRepository.insert({
          organizationId: run.organizationId,
          name: company.name,
          domain: company.domain,
          website: company.domain ? `https://${company.domain}` : null,
          ownerId: company.ownerId,
          source: "IMPORT",
          ...company.details,
        });
        existing.set(key, inserted.id);
        // Another request added the domain first: it's a duplicate.
        if (!inserted.created) return "skipped";
        await FieldValueRepository.write(
          run.organizationId,
          "COMPANY",
          inserted.id,
          company.writes,
        );
        return "created";
      }),
    );
  }
  return results;
}
