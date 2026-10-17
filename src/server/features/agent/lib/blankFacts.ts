import { AgentFactRepository } from "../repositories/AgentFactRepository";
import {
  canonicalValue,
  contactWrite,
  fillsBlank,
  isFactField,
  onRecord,
} from "./facts";

// The minute cron's pass over waiting suggestions, ported from the CRM's
// lib/blank-facts.ts. The write path already fills a blank with anything that
// clears the floor (facts.ts), so suggestions only wait on a field that held
// a value. When that field goes blank (a person cleared it), its best
// suggestion fills it; a suggestion that only repeats what the record now
// says is settled. A database pass: no model, no vendor, no budget.

// Suggestions read per organization per pass, and blanks filled at most.
const SCAN = 2000;
const MAX_FILLS = 500;

type Proposal = Awaited<
  ReturnType<typeof AgentFactRepository.proposals>
>[number];

type BlankFactSweep = {
  scanned: number;
  filled: number;
  settled: number;
  waiting: number;
};

/** One organization's pass. Idempotent: a second one finds nothing to do. */
async function sweepBlankFacts(
  organizationId: string,
): Promise<BlankFactSweep> {
  const proposals = await AgentFactRepository.proposals(organizationId, SCAN);
  const sweep = {
    scanned: proposals.length,
    filled: 0,
    settled: 0,
    waiting: 0,
  };
  if (proposals.length === 0) return sweep;
  const applied = await AgentFactRepository.appliedValues(organizationId, [
    ...new Set(proposals.map((row) => row.contactId)),
  ]);
  for (const group of groupByField(proposals)) {
    const [best] = group;
    const field = best.field;
    if (!isFactField(field)) {
      sweep.waiting += group.length;
      continue;
    }
    const current = applied.get(`${best.contactId}:${field}`) ?? null;
    if (!fillsBlank(field, best.contact, current)) {
      const stale = redundant(group, onRecord(field, best.contact, current));
      sweep.waiting += group.length - stale.length;
      if (stale.length > 0) {
        await AgentFactRepository.supersede(
          organizationId,
          stale.map((row) => row.id),
        );
        sweep.settled += stale.length;
      }
      continue;
    }
    if (sweep.filled >= MAX_FILLS) {
      sweep.waiting += group.length;
      continue;
    }
    const filled = await AgentFactRepository.fill(organizationId, {
      factId: best.id,
      contactId: best.contactId,
      field,
      write: contactWrite(field, best.value, best.contact),
    });
    if (!filled) {
      // Someone wrote the field meanwhile: the next pass sees it.
      sweep.waiting += group.length;
      continue;
    }
    sweep.filled += 1;
    sweep.settled += group.length - 1;
  }
  return sweep;
}

/**
 * The pass for the minute cron, over each organization with a suggestion
 * waiting. Never throws: one organization failing doesn't stop the others.
 */
export async function sweepAllBlankFacts(): Promise<void> {
  let organizations: string[];
  try {
    organizations = await AgentFactRepository.organizationsWithProposals();
  } catch (error) {
    console.error("[agent] could not list waiting suggestions", error);
    return;
  }
  for (const organizationId of organizations) {
    try {
      const sweep = await sweepBlankFacts(organizationId);
      if (sweep.filled + sweep.settled > 0) {
        console.log("[agent] blank fields filled from suggestions", {
          organizationId,
          ...sweep,
        });
      }
    } catch (error) {
      console.error(
        "[agent] could not fill an organization's blank fields",
        { organizationId },
        error,
      );
    }
  }
}

/** Suggestions grouped by contact and field, each group best first. */
function groupByField(proposals: Proposal[]): [Proposal, ...Proposal[]][] {
  const groups = new Map<string, [Proposal, ...Proposal[]]>();
  for (const row of proposals) {
    const key = `${row.contactId}:${row.field}`;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return [...groups.values()];
}

/** The suggestions that say what the record already says, or repeat another. */
function redundant(group: Proposal[], recordSays: string | null): Proposal[] {
  const recorded = recordSays ? canonicalValue(recordSays) : null;
  const kept = new Set<string>();
  return group.filter((row) => {
    const seen = canonicalValue(row.value);
    if (seen === recorded || kept.has(seen)) return true;
    kept.add(seen);
    return false;
  });
}
