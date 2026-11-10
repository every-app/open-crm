import { chunk, sortBy } from "remeda";
import { ListRepository } from "@/server/features/lists/repositories/ListRepository";
import { ListService } from "@/server/features/lists/services/ListService";
import { AppError, UserFacingError } from "@/server/lib/errors";
import type { FieldEntity } from "@/shared/crm-enums";
import { LIST_STAGE_TARGET } from "@/shared/imports";
import type { ImportChunkInput } from "@/types/schemas/imports";
import { LIST_IDS_MAX } from "@/types/schemas/lists";
import { importCompanies } from "./companyImport";
import { importContacts } from "./contactImport";
import { importDeals } from "./dealImport";
import { cell, openRun, type RowResult } from "./importRun";

// CSV import. The browser parses the file and sends its rows in chunks
// (IMPORT_CHUNK_SIZE), each one request: rows are matched to the records
// they already are (companies by domain, contacts by email, deals by name
// and company), then skipped or updated as the person chose, or created as
// imported records. Matching makes a chunk safe to send again, so an import
// that stopped halfway is re-run from the start without duplicating
// anything. A dry run says what would happen to each row and writes nothing.
// Contacts and companies can land in a list: every record a chunk created
// or updated goes in, at the stage its row names (else the import's), and
// one already there keeps its stage.

const IMPORTERS = {
  COMPANY: importCompanies,
  CONTACT: importContacts,
  DEAL: importDeals,
} satisfies Record<FieldEntity, unknown>;

/**
 * The list rows land in, with its stages: it must hold what's imported, be
 * live and have the stage named, checked before any row is written. Null
 * for no list.
 */
async function landingList(organizationId: string, input: ImportChunkInput) {
  if (!input.listId) return null;
  const list = await ListRepository.findById(organizationId, input.listId);
  if (!list || list.entity !== input.entity) {
    throw new AppError("NOT_FOUND", `No list with id ${input.listId}.`);
  }
  if (list.archivedAt) {
    throw new UserFacingError(
      "CONFLICT",
      `${list.name} is archived. Restore it first.`,
    );
  }
  const stages = await ListRepository.stagesOf(organizationId, [list.id]);
  if (input.stageId && !stages.some((stage) => stage.id === input.stageId)) {
    throw new AppError(
      "NOT_FOUND",
      `This list has no stage with id ${input.stageId}.`,
    );
  }
  return { name: list.name, stages };
}

async function importChunk(
  context: { organizationId: string; userId: string },
  input: ImportChunkInput,
): Promise<{ results: RowResult[] }> {
  const list = await landingList(context.organizationId, input);
  // The stage each row names, by line. A row naming one the list doesn't
  // have fails before anything of it is written.
  const stageOf = new Map<number, string>();
  const refused: RowResult[] = [];
  if (list) {
    for (const row of input.rows) {
      const name = cell(row.values, LIST_STAGE_TARGET);
      if (!name) continue;
      const stage = list.stages.find(
        (candidate) => candidate.name.toLowerCase() === name.toLowerCase(),
      );
      if (stage) stageOf.set(row.line, stage.id);
      else {
        refused.push({
          line: row.line,
          outcome: "failed",
          error: `${list.name} has no stage "${name}".`,
        });
      }
    }
  }
  const run = await openRun({
    organizationId: context.organizationId,
    userId: context.userId,
    entity: input.entity,
    duplicates: input.duplicates,
    dryRun: input.dryRun,
  });
  const refusedLines = new Set(refused.map((row) => row.line));
  const imported = await IMPORTERS[input.entity](
    run,
    input.rows.filter((row) => !refusedLines.has(row.line)),
  );
  if (!input.dryRun && input.listId) {
    // Each stage's records, the import's own stage for a row naming none.
    const byStage = new Map<string | null | undefined, string[]>();
    for (const row of imported) {
      if (!row.recordId) continue;
      const stageId = stageOf.get(row.line) ?? input.stageId;
      byStage.set(stageId, [...(byStage.get(stageId) ?? []), row.recordId]);
    }
    for (const [stageId, ids] of byStage) {
      for (const batch of chunk(ids, LIST_IDS_MAX)) {
        await ListService.addToList(context.organizationId, context.userId, {
          listId: input.listId,
          ids: batch,
          stageId,
        });
      }
    }
  }
  const results = sortBy([...imported, ...refused], (row) => row.line);
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
  return { results: results.map(({ recordId: _, ...row }) => row) };
}

export const ImportService = { importChunk };
