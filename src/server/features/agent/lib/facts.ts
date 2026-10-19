import type { FactBand } from "@/shared/crm-enums";
import {
  AgentFactRepository,
  type ContactValues,
  type ContactWrite,
  type FactColumn,
  type FactContact,
} from "../repositories/AgentFactRepository";
import { scoreEvidence, type Evidence } from "./evidence";
import { fullName, isDerivedName, splitName } from "./names";

// The evidence ledger's write path to a contact, ported from the CRM's
// lib/facts.ts, and the one place the CRM's fact rules live: the agent records
// facts through recordFact, the minute cron fills blanks with them
// (blankFacts.ts), and the contact sheet's Accept and Dismiss go through
// decideFact. The rules:
//
// - What the record holds now decides. Nothing a person put there is
//   overwritten: the agent owns a column only while it still holds the value
//   the agent applied, so a person's correction is theirs, and a column they
//   cleared is blank again.
// - A blank is filled by anything that clears the floor for keeping; a value
//   already there is replaced only by VERIFIED evidence (a primary source).
//   Anything else becomes a PROPOSED fact a person settles, but only where
//   accepting it writes the record (SUGGESTED_FIELDS): the employer, location
//   and tenure the record keeps no column for stay on the ledger for the
//   agent alone, as in the CRM, which never showed them to anybody.
// - Applying a fact settles the field's other facts (SUPERSEDED), so a
//   person never answers the same question twice; that is also how a job
//   change is noticed (lastEmployerChange).
// - The same value is never offered twice, and a value a person dismissed is
//   never offered again. Values compare as sameValue does: a URL as an
//   address, anything else as text.

export const FACT_FIELDS = [
  "name",
  "title",
  "linkedinUrl",
  "twitterUrl",
  "githubUrl",
  "employer",
  "seniority",
  "function",
  "location",
  "tenure",
] as const;

export type FactField = (typeof FACT_FIELDS)[number];

/** The contact column each fact field writes; null where the record has none (a name splits into first and last). */
const COLUMNS = {
  name: null,
  title: "title",
  linkedinUrl: "linkedinUrl",
  twitterUrl: "twitterUrl",
  githubUrl: "githubUrl",
  employer: null,
  seniority: "seniority",
  function: "function",
  location: null,
  tenure: null,
} as const satisfies Record<FactField, FactColumn | null>;

export function isFactField(field: string): field is FactField {
  return (FACT_FIELDS as readonly string[]).includes(field);
}

/** The fields a person is asked about: accepting a fact for one writes the contact. */
export const SUGGESTED_FIELDS: readonly FactField[] = FACT_FIELDS.filter(
  (field) => field === "name" || COLUMNS[field] !== null,
);

function isSuggested(field: string): boolean {
  return (SUGGESTED_FIELDS as readonly string[]).includes(field);
}

/**
 * How applying `value` as `field` changes the contact: what it writes, and,
 * given the contact as the caller read it, what the record must still hold
 * for the write to land (so a person's edit made meanwhile wins). Without a
 * contact (a person accepting a suggestion) the write is unconditional. Null
 * when the field has no column on the record.
 */
export function contactWrite(
  field: FactField,
  value: string,
  read: FactContact | null,
): ContactWrite | null {
  if (field === "name") {
    const split = splitName(value);
    if (!split) return null;
    return {
      patch: split,
      expected: read
        ? { firstName: read.firstName, lastName: read.lastName }
        : null,
    };
  }
  const column = COLUMNS[field];
  if (!column) return null;
  const patch: ContactValues = {};
  patch[column] = value.trim();
  const expected: ContactValues = {};
  if (read) expected[column] = read[column];
  return { patch, expected: read ? expected : null };
}

/**
 * What the record says for `field`: their name, its column, or for a field
 * it keeps no column for, the value the agent applied (`applied`).
 */
export function onRecord(
  field: FactField,
  read: FactContact,
  applied: string | null,
): string | null {
  if (field === "name") return fullName(read);
  const column = COLUMNS[field];
  return column ? read[column] || null : applied;
}

/** A person's value: a real name, or a column not holding what the agent applied. */
function humanOwns(
  field: FactField,
  read: FactContact,
  applied: string | null,
): boolean {
  if (field === "name") {
    return !isDerivedName(read.email, read.firstName, read.lastName);
  }
  const column = COLUMNS[field];
  const current = column ? read[column] : null;
  if (!current) return false;
  return applied === null || !sameValue(current, applied);
}

/**
 * Whether a fact may fill `field` without asking anybody: no person's value
 * in the way, and nothing on the record there (for a name or a field with no
 * column, nothing the agent found already).
 */
export function fillsBlank(
  field: FactField,
  read: FactContact,
  applied: string | null,
): boolean {
  if (humanOwns(field, read, applied)) return false;
  const column = COLUMNS[field];
  return column ? !read[column] : applied === null;
}

const HOST_ALIASES = new Map([
  ["twitter.com", "x.com"],
  ["mobile.twitter.com", "x.com"],
]);

/**
 * A value as it is compared, never as it is stored: lowercased, whitespace
 * collapsed, and a web address read as its host and path (no scheme, `www.`,
 * trailing slash or query; twitter.com is x.com).
 */
export function canonicalValue(value: string): string {
  const text = value.trim().replace(/\s+/g, " ").toLowerCase();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return text;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return text;
  const host = url.host.replace(/^www\./, "");
  return `${HOST_ALIASES.get(host) ?? host}${url.pathname.replace(/\/+$/, "")}`;
}

function sameValue(a: string, b: string): boolean {
  return canonicalValue(a) === canonicalValue(b);
}

type RecordFactInput = {
  contactId: string;
  field: FactField;
  value: string;
  evidence: Evidence[];
  method: string;
  sourceUrl?: string;
  /** The session that observed it. */
  sessionId: string;
};

export type RecordFactResult = {
  stored: boolean;
  applied: boolean;
  band: FactBand | null;
  score: number;
  rationale: string;
  reason?: string;
};

/**
 * Prices an observation and files it: applied to the record, proposed to a
 * person, or not stored at all, with the reason a rep (and the agent) can
 * read.
 */
export async function recordFact(
  organizationId: string,
  input: RecordFactInput,
): Promise<RecordFactResult> {
  const { contactId, field } = input;
  const value = input.value.trim();
  const scored = scoreEvidence(input.evidence);
  const base = {
    band: scored.band,
    score: scored.score,
    rationale: scored.rationale,
  };
  const refused = (reason: string) => ({
    ...base,
    stored: false,
    applied: false,
    reason,
  });
  if (!value) return refused("Empty value.");
  if (scored.band === null) {
    return refused(
      "Below the floor for keeping — not stored. Find a source that identifies them, or leave the field alone.",
    );
  }
  const read = await AgentFactRepository.contactFor(organizationId, contactId);
  if (!read) return refused("No such contact.");
  const existing = await AgentFactRepository.factsFor(
    organizationId,
    contactId,
    field,
  );
  const said = (status: string) =>
    existing.some(
      (fact) => fact.status === status && sameValue(fact.value, value),
    );
  if (said("DISMISSED")) {
    return refused(
      "A person has already dismissed this exact value. Do not offer it again.",
    );
  }
  const applied =
    existing.find((fact) => fact.status === "APPLIED")?.value ?? null;
  if (applied !== null && sameValue(applied, value)) {
    const held = onRecord(field, read, applied);
    return refused(
      held !== null && sameValue(held, applied)
        ? "Already on the record, from this same source. Nothing changed."
        : "A person took this value off the record. Do not put it back.",
    );
  }
  if (humanOwns(field, read, applied)) {
    return refused(
      `A person already filled in ${field}. That outranks anything found on the web.`,
    );
  }
  const applies =
    scored.band === "VERIFIED" || fillsBlank(field, read, applied);
  if (!applies && !isSuggested(field)) {
    return refused(
      `The ${field} already found stands until VERIFIED evidence replaces it; no rep is asked about it. Not stored.`,
    );
  }
  if (!applies && said("PROPOSED")) {
    return refused(
      "This exact value is already in front of a rep, waiting on them. Offering it twice only makes them read it twice.",
    );
  }
  const stored = await AgentFactRepository.record(organizationId, {
    fact: {
      contactId,
      field,
      value,
      score: scored.score,
      band: scored.band,
      evidence: input.evidence,
      method: input.method,
      sourceUrl: input.sourceUrl ?? null,
      sessionId: input.sessionId,
    },
    applied: applies,
    write: applies ? contactWrite(field, value, read) : null,
  });
  if (!stored) return refused("No such contact.");
  return {
    ...base,
    stored: true,
    applied: applies,
    reason: applies
      ? undefined
      : "The record already carries a value here, and only VERIFIED evidence may replace one, so this is kept as a proposal for a rep to accept or dismiss. This is a normal outcome, not a failure — do not try to raise the score.",
  };
}

type FactDecision =
  | { outcome: "decided"; contactId: string; field: string; applied: boolean }
  /** No such suggestion in this organization. */
  | { outcome: "missing" }
  /** Somebody (or the agent) settled it first. */
  | { outcome: "settled" };

/**
 * A person accepts or dismisses a proposed fact (the contact sheet). Accepting
 * applies it whatever the record holds, since a person chose it, and settles
 * the field's other facts; a dismissed value is never offered again.
 */
export async function decideFact(
  organizationId: string,
  input: { factId: string; accept: boolean; decidedById: string },
): Promise<FactDecision> {
  const fact = await AgentFactRepository.find(organizationId, input.factId);
  // A fact for a field the record keeps no column for is nobody's to settle.
  if (!fact || !isSuggested(fact.field)) return { outcome: "missing" };
  if (fact.status !== "PROPOSED") return { outcome: "settled" };
  const decided = await AgentFactRepository.decide(organizationId, {
    fact,
    accept: input.accept,
    decidedById: input.decidedById,
    write:
      input.accept && isFactField(fact.field)
        ? contactWrite(fact.field, fact.value, null)
        : null,
  });
  return decided
    ? {
        outcome: "decided",
        contactId: fact.contactId,
        field: fact.field,
        applied: input.accept,
      }
    : { outcome: "settled" };
}

/** The contact's employer change, read off the facts: the one replaced and the one now. */
export async function lastEmployerChange(
  organizationId: string,
  contactId: string,
) {
  const { previous, current } = await AgentFactRepository.employers(
    organizationId,
    contactId,
  );
  if (!previous || !current || sameValue(previous.value, current.value)) {
    return null;
  }
  return {
    from: previous.value,
    to: current.value,
    observedAt: current.observedAt,
    sourceUrl: current.sourceUrl,
  };
}
