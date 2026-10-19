import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { chunk } from "remeda";
import { db } from "@/db";
import { company, contact } from "@/db/schema";

// Research held for a person (services/ResearchHoldService.ts): a company's
// or a contact's `research_held_at`. Every read and write is scoped to the
// organization.

export type HeldKind = "company" | "contact";

// D1 binds at most 100 parameters per statement: id lists go in chunks.
const ID_CHUNK = 90;

const TABLES = { company, contact } as const;

/** Holds the research of the records that aren't held already. */
async function hold(
  organizationId: string,
  kind: HeldKind,
  ids: readonly string[],
): Promise<void> {
  const table = TABLES[kind];
  const now = new Date().toISOString();
  for (const part of chunk([...new Set(ids)], ID_CHUNK)) {
    await db
      .update(table)
      .set({ researchHeldAt: now })
      .where(
        and(
          eq(table.organizationId, organizationId),
          inArray(table.id, part),
          isNull(table.researchHeldAt),
        ),
      );
  }
}

/**
 * Lets the record's research go. True when this call released it, so two
 * people opening the record at once queue its research once.
 */
async function release(
  organizationId: string,
  kind: HeldKind,
  id: string,
): Promise<boolean> {
  const table = TABLES[kind];
  const released = await db
    .update(table)
    .set({ researchHeldAt: null })
    .where(
      and(
        eq(table.organizationId, organizationId),
        eq(table.id, id),
        isNotNull(table.researchHeldAt),
      ),
    )
    .returning({ id: table.id });
  return released.length > 0;
}

/** Whether the record's research waits for a person. */
async function isHeld(
  organizationId: string,
  kind: HeldKind,
  id: string,
): Promise<boolean> {
  const table = TABLES[kind];
  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(
      and(
        eq(table.organizationId, organizationId),
        eq(table.id, id),
        isNotNull(table.researchHeldAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export const ResearchHoldRepository = { hold, release, isHeld };
