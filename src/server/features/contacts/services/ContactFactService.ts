import { decideFact as decideAgentFact } from "@/server/features/agent/lib/facts";
import { AppError } from "@/server/lib/errors";
import type { DecideFactInput } from "@/types/schemas/contacts";

// A person settling what the research agent suggested about a contact. The
// agent applies a fact itself when its evidence is strong enough or the
// field is blank, and proposes it otherwise: a value already on the record
// is replaced only when a person says so. The rules live with the agent's
// evidence ledger (agent/lib/facts.ts); this is the contact sheet's way in.

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
  const decision = await decideAgentFact(organizationId, {
    factId: input.factId,
    accept: input.decision === "accept",
    decidedById: userId,
  });
  if (decision.outcome === "missing") {
    throw new AppError("NOT_FOUND", `No suggestion with id ${input.factId}.`);
  }
  if (decision.outcome === "settled") {
    throw new AppError("CONFLICT", "That suggestion has already been settled.");
  }
  console.log("[contacts] fact decided", {
    organizationId,
    contactId: decision.contactId,
    factId: input.factId,
    field: decision.field,
    decision: input.decision,
  });
  return {
    contactId: decision.contactId,
    field: decision.field,
    applied: decision.applied,
  };
}

export const ContactFactService = {
  decideFact,
};
