import { and, desc, eq, exists, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import { contact, contactBrief, contactFact } from "@/db/schema";

// What the research agent wrote about a contact: evidence-priced facts and
// a brief. The agent writes them (its own write path); people only read them
// and settle the facts it proposed. An APPLIED fact already changed the
// record; a PROPOSED one waits for a person; a DISMISSED one is never offered
// again; a SUPERSEDED one was replaced by a later fact for the same field.

// What the agent observed behind a fact: the evidence ledger's entries.
const evidenceSchema = z
  .array(
    z.object({
      kind: z.string(),
      detail: z.string(),
      sourceUrl: z.string().optional(),
    }),
  )
  .catch([]);

// The brief's structured lines, as the agent writes them. A line that
// doesn't parse is dropped rather than failing the sheet.
const sectionsSchema = z
  .object({
    currentRole: z.string().optional().catch(undefined),
    tenure: z.string().optional().catch(undefined),
    previousRoles: z.array(z.string()).optional().catch(undefined),
    seniority: z.string().optional().catch(undefined),
    function: z.string().optional().catch(undefined),
    location: z.string().optional().catch(undefined),
  })
  .catch({});

/** The contact's applied and proposed facts, newest first. */
async function listOpen(organizationId: string, contactId: string) {
  const rows = await db
    .select({
      id: contactFact.id,
      field: contactFact.field,
      value: contactFact.value,
      score: contactFact.score,
      band: contactFact.band,
      evidence: contactFact.evidence,
      method: contactFact.method,
      sourceUrl: contactFact.sourceUrl,
      status: contactFact.status,
      observedAt: contactFact.observedAt,
    })
    .from(contactFact)
    .where(
      and(
        eq(contactFact.organizationId, organizationId),
        eq(contactFact.contactId, contactId),
        inArray(contactFact.status, ["APPLIED", "PROPOSED"]),
      ),
    )
    .orderBy(desc(contactFact.observedAt), desc(contactFact.id));
  return rows.map((row) => ({
    ...row,
    evidence: evidenceSchema.parse(row.evidence),
  }));
}

/** The contact's brief, if the agent wrote one. */
async function findBrief(organizationId: string, contactId: string) {
  const [row] = await db
    .select({
      narrative: contactBrief.narrative,
      sections: contactBrief.sections,
      score: contactBrief.score,
      sourceUrl: contactBrief.sourceUrl,
      refreshedAt: contactBrief.refreshedAt,
    })
    .from(contactBrief)
    .where(
      and(
        eq(contactBrief.organizationId, organizationId),
        eq(contactBrief.contactId, contactId),
      ),
    )
    .limit(1);
  return row ? { ...row, sections: sectionsSchema.parse(row.sections) } : null;
}

/** One fact of the organization's, or null. */
async function findById(organizationId: string, factId: string) {
  const [row] = await db
    .select({
      id: contactFact.id,
      contactId: contactFact.contactId,
      field: contactFact.field,
      value: contactFact.value,
      status: contactFact.status,
    })
    .from(contactFact)
    .where(
      and(
        eq(contactFact.organizationId, organizationId),
        eq(contactFact.id, factId),
      ),
    )
    .limit(1);
  return row ?? null;
}

type Decision = {
  factId: string;
  userId: string;
  /** What accepting writes on the contact; null for a dismissal. */
  apply: {
    contactId: string;
    field: string;
    patch: Partial<typeof contact.$inferInsert>;
  } | null;
};

/**
 * Settles a proposed fact: dismissed, or applied, which supersedes the
 * field's other applied and proposed facts and writes the contact. One
 * batch on both backends. Its first statement claims the fact (still
 * PROPOSED, so two people settling it at once can't both win), and the
 * rest only follow that claim. True when this call settled it.
 */
async function decide(
  organizationId: string,
  decision: Decision,
): Promise<boolean> {
  const { factId, userId, apply } = decision;
  const now = new Date().toISOString();
  const status = apply ? "APPLIED" : "DISMISSED";
  const fact = and(
    eq(contactFact.organizationId, organizationId),
    eq(contactFact.id, factId),
  );
  const claimed = and(
    fact,
    eq(contactFact.status, status),
    eq(contactFact.decidedById, userId),
    eq(contactFact.decidedAt, now),
  );
  const ours = exists(
    db.select({ id: contactFact.id }).from(contactFact).where(claimed),
  );
  await runBatch((tx) => [
    tx
      .update(contactFact)
      .set({ status, decidedById: userId, decidedAt: now })
      .where(and(fact, eq(contactFact.status, "PROPOSED"))),
    ...(apply
      ? [
          tx
            .update(contactFact)
            .set({ status: "SUPERSEDED", supersededAt: now })
            .where(
              and(
                eq(contactFact.organizationId, organizationId),
                eq(contactFact.contactId, apply.contactId),
                eq(contactFact.field, apply.field),
                ne(contactFact.id, factId),
                inArray(contactFact.status, ["APPLIED", "PROPOSED"]),
                ours,
              ),
            ),
          ...(Object.keys(apply.patch).length > 0
            ? [
                tx
                  .update(contact)
                  .set({ ...apply.patch, updatedAt: now })
                  .where(
                    and(
                      eq(contact.organizationId, organizationId),
                      eq(contact.id, apply.contactId),
                      ours,
                    ),
                  ),
              ]
            : []),
        ]
      : []),
  ]);
  const [row] = await db
    .select({ id: contactFact.id })
    .from(contactFact)
    .where(claimed);
  return Boolean(row);
}

export const ContactFactRepository = {
  listOpen,
  findBrief,
  findById,
  decide,
};
