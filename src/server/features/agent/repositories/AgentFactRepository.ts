import {
  and,
  desc,
  eq,
  exists,
  inArray,
  isNull,
  ne,
  type SQL,
} from "drizzle-orm";
import { chunk } from "remeda";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import { contact, contactFact } from "@/db/schema";
import type { FactStatus } from "@/shared/crm-enums";
import { descNullsLast } from "./order";

// The evidence ledger's rows (contact_fact) and the contact columns a fact
// writes. The rules live in lib/facts.ts; this only reads and writes, scoped
// to the organization like every other repository, with each multi-row write
// in one batch.

const FACT_COLUMNS = [
  "title",
  "seniority",
  "function",
  "linkedinUrl",
  "twitterUrl",
  "githubUrl",
] as const;

/** The contact columns a fact field writes. */
export type FactColumn = (typeof FACT_COLUMNS)[number];

/** A contact as the fact rules read it. */
export type FactContact = {
  id: string;
  email: string | null;
  firstName: string;
  lastName: string | null;
} & Record<FactColumn, string | null>;

/** Values a fact writes onto a contact, or that a write expects to find there (null: empty). */
export type ContactValues = Partial<
  Record<FactColumn | "lastName", string | null>
> & { firstName?: string };

/** A write onto the contact, made only while it still holds `expected`. */
export type ContactWrite = {
  patch: ContactValues;
  expected: ContactValues | null;
};

type NewFact = Pick<
  typeof contactFact.$inferInsert,
  | "contactId"
  | "field"
  | "value"
  | "score"
  | "band"
  | "evidence"
  | "method"
  | "sourceUrl"
  | "sessionId"
>;

type Batch = typeof db;

const VALUE_KEYS = [...FACT_COLUMNS, "firstName", "lastName"] as const;

const LIVE: FactStatus[] = ["APPLIED", "PROPOSED"];

// D1 binds about 100 parameters per statement.
const IDS_PER_STATEMENT = 90;

// Conditions and columns are built per call: `@/db/schema` hands out
// whichever dialect's tables are live.
const ofContact = (organizationId: string, contactId: string) =>
  and(eq(contact.organizationId, organizationId), eq(contact.id, contactId));

const ofFact = (organizationId: string, factId: string) =>
  and(
    eq(contactFact.organizationId, organizationId),
    eq(contactFact.id, factId),
  );

const ofField = (organizationId: string, contactId: string, field: string) =>
  and(
    eq(contactFact.organizationId, organizationId),
    eq(contactFact.contactId, contactId),
    eq(contactFact.field, field),
  );

function contactColumns() {
  return {
    id: contact.id,
    email: contact.email,
    firstName: contact.firstName,
    lastName: contact.lastName,
    title: contact.title,
    seniority: contact.seniority,
    function: contact.function,
    linkedinUrl: contact.linkedinUrl,
    twitterUrl: contact.twitterUrl,
    githubUrl: contact.githubUrl,
  };
}

/** The contact still holds `expected`: what the caller read before deciding. */
function holds(expected: ContactValues | null): SQL[] {
  if (!expected) return [];
  return VALUE_KEYS.flatMap((key) => {
    const value = expected[key];
    if (value === undefined) return [];
    return [value === null ? isNull(contact[key]) : eq(contact[key], value)];
  });
}

/** Settles the field's live facts (but `except`), while `condition` holds. */
function settleField(
  tx: Batch,
  organizationId: string,
  field: { contactId: string; field: string; except?: string },
  now: string,
  condition?: SQL,
) {
  return tx
    .update(contactFact)
    .set({ status: "SUPERSEDED", supersededAt: now })
    .where(
      and(
        ofField(organizationId, field.contactId, field.field),
        inArray(contactFact.status, LIVE),
        field.except ? ne(contactFact.id, field.except) : undefined,
        condition,
      ),
    );
}

/** Writes onto the contact, while it holds what the write expects. */
function writeContact(
  tx: Batch,
  organizationId: string,
  contactId: string,
  write: ContactWrite,
  now: string,
) {
  return tx
    .update(contact)
    .set({ ...write.patch, updatedAt: now })
    .where(and(ofContact(organizationId, contactId), ...holds(write.expected)));
}

async function contactFor(
  organizationId: string,
  contactId: string,
): Promise<FactContact | null> {
  const [row] = await db
    .select(contactColumns())
    .from(contact)
    .where(ofContact(organizationId, contactId))
    .limit(1);
  return row ?? null;
}

/** Every fact recorded for one field of one contact, settled ones included. */
async function factsFor(
  organizationId: string,
  contactId: string,
  field: string,
) {
  return db
    .select({
      id: contactFact.id,
      value: contactFact.value,
      status: contactFact.status,
    })
    .from(contactFact)
    .where(ofField(organizationId, contactId, field));
}

/**
 * Stores a fact. An applied one settles the field's earlier facts (applied
 * and proposed) and writes `write` onto the contact, in one batch. False when
 * the contact isn't the organization's.
 */
async function record(
  organizationId: string,
  input: { fact: NewFact; applied: boolean; write: ContactWrite | null },
): Promise<boolean> {
  const { fact, applied, write } = input;
  if (!(await contactFor(organizationId, fact.contactId))) return false;
  const now = new Date().toISOString();
  await runBatch((tx) => [
    ...(applied ? [settleField(tx, organizationId, fact, now)] : []),
    tx.insert(contactFact).values({
      id: crypto.randomUUID(),
      organizationId,
      ...fact,
      status: applied ? "APPLIED" : "PROPOSED",
      observedAt: now,
    }),
    ...(applied && write
      ? [writeContact(tx, organizationId, fact.contactId, write, now)]
      : []),
  ]);
  return true;
}

async function find(organizationId: string, factId: string) {
  const [row] = await db
    .select({
      id: contactFact.id,
      contactId: contactFact.contactId,
      field: contactFact.field,
      value: contactFact.value,
      status: contactFact.status,
    })
    .from(contactFact)
    .where(ofFact(organizationId, factId))
    .limit(1);
  return row ?? null;
}

/**
 * A person's decision on a proposed fact, once: the fact is claimed only
 * while it is still PROPOSED, and an accept's other writes (settling the
 * field's other facts, writing the contact) happen only under that claim, in
 * the same batch. False when someone settled it first.
 */
async function decide(
  organizationId: string,
  input: {
    fact: { id: string; contactId: string; field: string };
    accept: boolean;
    decidedById: string;
    write: ContactWrite | null;
  },
): Promise<boolean> {
  const { fact, accept, decidedById, write } = input;
  const now = new Date().toISOString();
  const ours = and(
    ofFact(organizationId, fact.id),
    eq(contactFact.decidedById, decidedById),
    eq(contactFact.decidedAt, now),
  );
  const claimed = (tx: Batch) =>
    exists(tx.select({ id: contactFact.id }).from(contactFact).where(ours));
  await runBatch((tx) => [
    tx
      .update(contactFact)
      .set({
        status: accept ? "APPLIED" : "DISMISSED",
        decidedById,
        decidedAt: now,
      })
      .where(
        and(
          ofFact(organizationId, fact.id),
          eq(contactFact.status, "PROPOSED"),
        ),
      ),
    ...(accept
      ? [
          settleField(
            tx,
            organizationId,
            { ...fact, except: fact.id },
            now,
            claimed(tx),
          ),
        ]
      : []),
    ...(accept && write
      ? [
          tx
            .update(contact)
            .set({ ...write.patch, updatedAt: now })
            .where(and(ofContact(organizationId, fact.contactId), claimed(tx))),
        ]
      : []),
  ]);
  const [row] = await db
    .select({ id: contactFact.id })
    .from(contactFact)
    .where(ours)
    .limit(1);
  return Boolean(row);
}

/** The latest employer that was replaced, and the one on the record now. */
async function employers(organizationId: string, contactId: string) {
  const employer = ofField(organizationId, contactId, "employer");
  const [[previous], [current]] = await Promise.all([
    db
      .select({ value: contactFact.value })
      .from(contactFact)
      .where(and(employer, eq(contactFact.status, "SUPERSEDED")))
      .orderBy(descNullsLast(contactFact.supersededAt))
      .limit(1),
    db
      .select({
        value: contactFact.value,
        observedAt: contactFact.observedAt,
        sourceUrl: contactFact.sourceUrl,
      })
      .from(contactFact)
      .where(and(employer, eq(contactFact.status, "APPLIED")))
      .orderBy(desc(contactFact.observedAt))
      .limit(1),
  ]);
  return { previous: previous ?? null, current: current ?? null };
}

/**
 * Organizations with a suggestion waiting, for the minute cron's blank-field
 * sweep: the one read here not scoped to an organization, which only names
 * the organizations each sweep then works in.
 */
async function organizationsWithProposals(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ organizationId: contactFact.organizationId })
    .from(contactFact)
    .where(eq(contactFact.status, "PROPOSED"))
    .orderBy(contactFact.organizationId);
  return rows.map((row) => row.organizationId);
}

/** Waiting suggestions with their contacts, the best-evidenced first. */
async function proposals(organizationId: string, limit: number) {
  return db
    .select({
      id: contactFact.id,
      contactId: contactFact.contactId,
      field: contactFact.field,
      value: contactFact.value,
      contact: contactColumns(),
    })
    .from(contactFact)
    .innerJoin(
      contact,
      and(
        eq(contact.id, contactFact.contactId),
        eq(contact.organizationId, organizationId),
      ),
    )
    .where(
      and(
        eq(contactFact.organizationId, organizationId),
        eq(contactFact.status, "PROPOSED"),
      ),
    )
    .orderBy(desc(contactFact.score), desc(contactFact.observedAt))
    .limit(limit);
}

/** The applied value of each field of each of `contactIds`, by `contactId:field`. */
async function appliedValues(
  organizationId: string,
  contactIds: string[],
): Promise<Map<string, string>> {
  const values = new Map<string, string>();
  for (const part of chunk(contactIds, IDS_PER_STATEMENT)) {
    const rows = await db
      .select({
        contactId: contactFact.contactId,
        field: contactFact.field,
        value: contactFact.value,
      })
      .from(contactFact)
      .where(
        and(
          eq(contactFact.organizationId, organizationId),
          eq(contactFact.status, "APPLIED"),
          inArray(contactFact.contactId, part),
        ),
      );
    for (const row of rows) {
      values.set(`${row.contactId}:${row.field}`, row.value);
    }
  }
  return values;
}

/** Settles suggestions that no longer say anything. */
async function supersede(organizationId: string, ids: string[]): Promise<void> {
  const now = new Date().toISOString();
  for (const part of chunk(ids, IDS_PER_STATEMENT)) {
    await db
      .update(contactFact)
      .set({ status: "SUPERSEDED", supersededAt: now })
      .where(
        and(
          eq(contactFact.organizationId, organizationId),
          inArray(contactFact.id, part),
          eq(contactFact.status, "PROPOSED"),
        ),
      );
  }
}

/**
 * Applies a waiting suggestion into a blank: settles the field's other
 * facts, marks it applied and writes `write` onto the contact, in one batch,
 * and only while the contact still holds what the sweep read. True when it
 * was applied.
 */
async function fill(
  organizationId: string,
  input: {
    factId: string;
    contactId: string;
    field: string;
    write: ContactWrite | null;
  },
): Promise<boolean> {
  const { factId, contactId, write } = input;
  const now = new Date().toISOString();
  const unchanged = (tx: Batch) =>
    exists(
      tx
        .select({ id: contact.id })
        .from(contact)
        .where(
          and(
            ofContact(organizationId, contactId),
            ...holds(write?.expected ?? null),
          ),
        ),
    );
  await runBatch((tx) => [
    settleField(
      tx,
      organizationId,
      { ...input, except: factId },
      now,
      unchanged(tx),
    ),
    tx
      .update(contactFact)
      .set({ status: "APPLIED" })
      .where(
        and(
          ofFact(organizationId, factId),
          eq(contactFact.status, "PROPOSED"),
          unchanged(tx),
        ),
      ),
    ...(write ? [writeContact(tx, organizationId, contactId, write, now)] : []),
  ]);
  const [row] = await db
    .select({ status: contactFact.status })
    .from(contactFact)
    .where(ofFact(organizationId, factId))
    .limit(1);
  return row?.status === "APPLIED";
}

export const AgentFactRepository = {
  contactFor,
  factsFor,
  record,
  find,
  decide,
  employers,
  organizationsWithProposals,
  proposals,
  appliedValues,
  supersede,
  fill,
};
