import { AgentTaskService } from "@/server/features/agent/services/AgentTaskService";
import { FieldDefinitionRepository } from "@/server/features/fields/repositories/FieldDefinitionRepository";
import { FIELD_ENTITIES, type FieldEntity } from "@/shared/crm-enums";
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
  if (input.research && !input.dryRun) await queueResearch(run);
  return { results };
}

/**
 * The research agent's work on what the chunk created, paced so a large
 * import doesn't take over the queue (AgentTaskService.recordsImported).
 * Never fails the import: the records are in.
 */
async function queueResearch(
  run: Awaited<ReturnType<typeof openRun>>,
): Promise<void> {
  try {
    const imported = [];
    for (const entity of FIELD_ENTITIES) {
      const ids = run.created[entity];
      if (ids.length === 0) continue;
      const fields =
        entity === run.entity
          ? run.fields
          : await FieldDefinitionRepository.list(run.organizationId, entity, {
              includeArchived: false,
            });
      imported.push({
        entity,
        ids,
        agentFilledKeys: fields
          .filter((field) => field.agentFilled)
          .map((field) => field.key),
      });
    }
    if (imported.length === 0) return;
    await AgentTaskService.recordsImported(run.organizationId, imported);
  } catch (error) {
    console.error(
      "[import] could not queue the agent for imported records",
      { organizationId: run.organizationId },
      error,
    );
  }
}

export const ImportService = { importChunk };
