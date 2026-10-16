import type { contact } from "@/db/schema";
import { ContactFactRepository } from "@/server/features/contacts/repositories/ContactFactRepository";
import { AppError } from "@/server/lib/errors";
import type { DecideFactInput } from "@/types/schemas/contacts";

// A person settling what the research agent suggested about a contact. The
// agent applies a fact itself when its evidence is strong enough or the
// field is blank, and proposes it otherwise: a value already on the record
// is replaced only when a person says so.

type ContactPatch = Partial<typeof contact.$inferInsert>;

// The contact column each fact field fills when it is applied, as the
// agent's own write path fills them. A field without one (employer,
// location, tenure) is kept as a fact only; a name is split into first and
// last name.
const FACT_COLUMNS = {
  title: "title",
  seniority: "seniority",
  function: "function",
  linkedinUrl: "linkedinUrl",
  twitterUrl: "twitterUrl",
  githubUrl: "githubUrl",
} as const;

function isColumnField(field: string): field is keyof typeof FACT_COLUMNS {
  return Object.hasOwn(FACT_COLUMNS, field);
}

/** What applying a fact writes on the contact. */
function factPatch(field: string, value: string): ContactPatch {
  const patch: ContactPatch = {};
  if (isColumnField(field)) patch[FACT_COLUMNS[field]] = value;
  if (field === "name") {
    const [firstName, ...rest] = value.trim().split(/\s+/);
    if (firstName) {
      patch.firstName = firstName;
      patch.lastName = rest.length > 0 ? rest.join(" ") : null;
    }
  }
  return patch;
}

/**
 * Accepts or dismisses one of the agent's proposed facts. Accepting writes
 * the value on the contact and supersedes the field's other facts;
 * dismissing keeps the fact, so the agent never offers that value again.
 */
async function decideFact(
  organizationId: string,
  userId: string,
  input: DecideFactInput,
) {
  const fact = await ContactFactRepository.findById(
    organizationId,
    input.factId,
  );
  if (!fact) {
    throw new AppError("NOT_FOUND", `No suggestion with id ${input.factId}.`);
  }
  const settled = new AppError(
    "CONFLICT",
    "That suggestion has already been settled.",
  );
  if (fact.status !== "PROPOSED") throw settled;
  const accepted = input.decision === "accept";
  const decided = await ContactFactRepository.decide(organizationId, {
    factId: fact.id,
    userId,
    apply: accepted
      ? {
          contactId: fact.contactId,
          field: fact.field,
          patch: factPatch(fact.field, fact.value),
        }
      : null,
  });
  if (!decided) throw settled;
  console.log("[contacts] fact decided", {
    organizationId,
    contactId: fact.contactId,
    factId: fact.id,
    field: fact.field,
    decision: input.decision,
  });
  return { contactId: fact.contactId, field: fact.field, applied: accepted };
}

export const ContactFactService = {
  decideFact,
};
