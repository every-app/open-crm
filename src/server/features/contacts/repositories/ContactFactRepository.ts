import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { contact, contactBrief, contactFact } from "@/db/schema";

// What the research agent wrote about a contact: evidence-priced facts and
// a brief, as the contact sheet reads them. The agent writes them, and a
// person settles the facts it proposed, through its evidence ledger
// (agent/lib/facts.ts). An APPLIED fact already changed the
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

/**
 * The facts waiting for a person on the organization's live contacts (or
 * one contact's), newest first, a page at a time, with how many there are.
 */
async function listProposed(
  organizationId: string,
  input: { contactId?: string; limit: number; offset: number },
) {
  const where = and(
    eq(contactFact.organizationId, organizationId),
    eq(contactFact.status, "PROPOSED"),
    input.contactId ? eq(contactFact.contactId, input.contactId) : undefined,
    isNull(contact.archivedAt),
  );
  const ofLiveContact = and(
    eq(contact.id, contactFact.contactId),
    eq(contact.organizationId, organizationId),
  );
  const [rows, [counted]] = await Promise.all([
    db
      .select({
        id: contactFact.id,
        contactId: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email,
        field: contactFact.field,
        value: contactFact.value,
        band: contactFact.band,
        evidence: contactFact.evidence,
        sourceUrl: contactFact.sourceUrl,
        observedAt: contactFact.observedAt,
      })
      .from(contactFact)
      .innerJoin(contact, ofLiveContact)
      .where(where)
      .orderBy(desc(contactFact.observedAt), desc(contactFact.id))
      .limit(input.limit)
      .offset(input.offset),
    db
      .select({ value: count() })
      .from(contactFact)
      .innerJoin(contact, ofLiveContact)
      .where(where),
  ]);
  return {
    rows: rows.map((row) => ({
      ...row,
      evidence: evidenceSchema.parse(row.evidence),
    })),
    total: counted?.value ?? 0,
  };
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

export const ContactFactRepository = {
  listOpen,
  listProposed,
  findBrief,
};
