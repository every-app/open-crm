import type { FieldEntity } from "@/shared/crm-enums";
import type { ImportChunkInput } from "@/types/schemas/imports";
import { importCompanies } from "./companyImport";
import { importContacts } from "./contactImport";
import { importDeals } from "./dealImport";
import { openRun, type RowResult } from "./importRun";

// CSV import. The browser parses the file and sends its rows in chunks
// (IMPORT_CHUNK_SIZE), each one request: rows are matched to the records
// they already are (companies by domain, contacts by email, deals by name
// and company), then skipped or updated as the person chose, or created as
// imported records. Matching makes a chunk safe to send again, so an import
// that stopped halfway is re-run from the start without duplicating
// anything. A dry run says what would happen to each row and writes nothing.

const IMPORTERS = {
  COMPANY: importCompanies,
  CONTACT: importContacts,
  DEAL: importDeals,
} satisfies Record<FieldEntity, unknown>;

async function importChunk(
  context: { organizationId: string; userId: string },
  input: ImportChunkInput,
): Promise<{ results: RowResult[] }> {
  const run = await openRun({
    organizationId: context.organizationId,
    userId: context.userId,
    entity: input.entity,
    duplicates: input.duplicates,
    dryRun: input.dryRun,
  });
  const results = await IMPORTERS[input.entity](run, input.rows);
  if (!input.dryRun) {
    console.log("[import] chunk", {
      organizationId: context.organizationId,
      entity: input.entity,
      rows: input.rows.length,
      created: results.filter((row) => row.outcome === "created").length,
      updated: results.filter((row) => row.outcome === "updated").length,
      failed: results.filter((row) => row.outcome === "failed").length,
    });
  }
  return { results };
}

export const ImportService = { importChunk };
