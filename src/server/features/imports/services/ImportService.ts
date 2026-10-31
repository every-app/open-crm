import { chunk } from "remeda";
import { ListRepository } from "@/server/features/lists/repositories/ListRepository";
import { ListService } from "@/server/features/lists/services/ListService";
import { AppError, UserFacingError } from "@/server/lib/errors";
import type { FieldEntity } from "@/shared/crm-enums";
import type { ImportChunkInput } from "@/types/schemas/imports";
import { LIST_IDS_MAX } from "@/types/schemas/lists";
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
// Contacts and companies can land in a list: every record a chunk created
// or updated goes in, and one already there keeps its stage.

const IMPORTERS = {
  COMPANY: importCompanies,
  CONTACT: importContacts,
  DEAL: importDeals,
} satisfies Record<FieldEntity, unknown>;

/**
 * The list rows land in must hold what's imported, be live and have the
 * stage named: checked before any row is written.
 */
async function checkList(organizationId: string, input: ImportChunkInput) {
  if (!input.listId) return;
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
  if (input.stageId) {
    const stages = await ListRepository.stagesOf(organizationId, [list.id]);
    if (!stages.some((stage) => stage.id === input.stageId)) {
      throw new AppError(
        "NOT_FOUND",
        `This list has no stage with id ${input.stageId}.`,
      );
    }
  }
}

async function importChunk(
  context: { organizationId: string; userId: string },
  input: ImportChunkInput,
): Promise<{ results: RowResult[] }> {
  await checkList(context.organizationId, input);
  const run = await openRun({
    organizationId: context.organizationId,
    userId: context.userId,
    entity: input.entity,
    duplicates: input.duplicates,
    dryRun: input.dryRun,
  });
  const results = await IMPORTERS[input.entity](run, input.rows);
  if (!input.dryRun && input.listId) {
    const ids = results.flatMap((row) => (row.recordId ? [row.recordId] : []));
    for (const batch of chunk(ids, LIST_IDS_MAX)) {
      await ListService.addToList(context.organizationId, context.userId, {
        listId: input.listId,
        ids: batch,
        stageId: input.stageId,
      });
    }
  }
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
