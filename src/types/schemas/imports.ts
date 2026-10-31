import { z } from "zod";
import { FIELD_ENTITIES } from "@/shared/crm-enums";
import { IMPORT_CHUNK_SIZE, IMPORT_DUPLICATES } from "@/shared/imports";

/** One CSV row, its values keyed by the field each column maps to. */
const importRowSchema = z.object({
  /** The row's line in the file, for the report. */
  line: z.number().int().min(1),
  values: z.record(z.string().min(1).max(120), z.string().max(20_000)),
});

/**
 * A chunk of an import. `dryRun` checks the rows and says what would happen
 * to each, writing nothing: the dialog's preview. Contacts and companies
 * can land in a list (`listId`), at `stageId` (as adding to a list takes
 * it: left out, the list's first stage; null, none).
 */
export const importChunkSchema = z
  .object({
    entity: z.enum(FIELD_ENTITIES),
    duplicates: z.enum(IMPORT_DUPLICATES),
    dryRun: z.boolean().default(false),
    rows: z.array(importRowSchema).min(1).max(IMPORT_CHUNK_SIZE),
    listId: z.string().min(1).max(64).optional(),
    stageId: z.string().min(1).max(64).nullable().optional(),
  })
  .refine((input) => !input.listId || input.entity !== "DEAL", {
    message: "Deals can't be added to a list.",
    path: ["listId"],
  });

export type ImportChunkInput = z.infer<typeof importChunkSchema>;
