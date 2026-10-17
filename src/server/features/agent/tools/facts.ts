import { tool } from "ai";
import { z } from "zod";
import { EVIDENCE_KINDS } from "../lib/evidence";
import {
  FACT_FIELDS,
  lastEmployerChange,
  recordFact,
  type RecordFactResult,
} from "../lib/facts";
import { fullName } from "../lib/names";
import { AgentPeopleRepository } from "../repositories/AgentPeopleRepository";
import type { ToolGroup } from "./context";

// The evidence ledger's tools, ported from the CRM's record_fact,
// identify_contact and record_job_change. No tool takes a confidence: the
// agent reports what it observed, and lib/facts.ts prices it and decides
// whether it lands on the record or waits for a person.

function evidenceList(detail: string) {
  return z
    .array(
      z.object({
        kind: z
          .enum(EVIDENCE_KINDS)
          .describe(
            "What kind of thing you saw. Use `contradiction` when two sources disagree.",
          ),
        detail: z.string().describe(detail),
        sourceUrl: z.string().optional(),
      }),
    )
    .min(1)
    .describe("Everything you observed. One entry per independent source.");
}

function report(result: RecordFactResult) {
  return {
    stored: result.stored,
    applied: result.applied,
    band: result.band,
    score: Math.round(result.score * 100) / 100,
    rationale: result.rationale,
    reason: result.reason || undefined,
  };
}

const UNATTENDED_JOB_CHANGE =
  "Not something to do unattended. The new employer is on the record as a fact; a rep raises the change from there.";

export const factTools: ToolGroup = (context) => ({
  record_fact: tool({
    description:
      "Record one claim about a contact — title, employer, a profile URL, seniority — together with the evidence for it. The evidence decides whether it is written to the record or offered to a rep as a suggestion. Never invent evidence you did not observe.",
    inputSchema: z.object({
      contactId: z.string(),
      field: z.enum(FACT_FIELDS).describe("Which fact about them this is."),
      value: z
        .string()
        .describe("The claim itself, exactly as the source states it."),
      evidence: evidenceList(
        "What it actually said, in one line a rep would understand.",
      ),
      method: z
        .string()
        .describe(
          'Where it came from: "linkedin.profile", "github.api", "crm.thread", "web".',
        ),
      sourceUrl: z
        .string()
        .optional()
        .describe("The page a rep should open to check."),
    }),
    execute: async (input) =>
      report(
        await recordFact(context.organizationId, {
          ...input,
          sessionId: context.sessionId,
        }),
      ),
  }),

  identify_contact: tool({
    description:
      "Put a verified name to a CRM contact, with the evidence for it. Strong evidence writes the name; anything less becomes a suggestion for a rep. Never overwrites a name a person supplied.",
    inputSchema: z.object({
      contactId: z.string(),
      fullName: z.string().describe("Exactly as the source writes it."),
      evidence: evidenceList("What the source actually said."),
      sourceUrl: z.string().describe("The page a rep should open to check."),
    }),
    execute: async (input) =>
      report(
        await recordFact(context.organizationId, {
          contactId: input.contactId,
          field: "name",
          value: input.fullName,
          evidence: input.evidence,
          method: "identity",
          sourceUrl: input.sourceUrl,
          sessionId: context.sessionId,
        }),
      ),
  }),

  record_job_change: tool({
    description:
      "Raise a job change on a contact's timeline, where their owner sees it. Reads the change from the facts already recorded; call it after recording a new employer. A person approves it first.",
    inputSchema: z.object({
      contactId: z.string(),
      moveToCompanyId: z
        .string()
        .optional()
        .describe(
          "Only when the new employer is already a company in the CRM and a person has approved the move.",
        ),
    }),
    // A person in the conversation approves it; with nobody there, it is
    // refused below rather than left waiting.
    needsApproval: context.attended,
    execute: async ({ contactId, moveToCompanyId }) => {
      if (!context.attended) {
        return { raised: false as const, reason: UNATTENDED_JOB_CHANGE };
      }
      const { organizationId } = context;
      const change = await lastEmployerChange(organizationId, contactId);
      if (!change) {
        return {
          raised: false as const,
          reason: "No employer change on the facts for this contact.",
        };
      }
      const person = await AgentPeopleRepository.subject(
        organizationId,
        contactId,
      );
      if (!person)
        return { raised: false as const, reason: "No such contact." };
      if (
        moveToCompanyId &&
        !(await AgentPeopleRepository.companyExists(
          organizationId,
          moveToCompanyId,
        ))
      ) {
        return {
          raised: false as const,
          reason: "There is no such company in the CRM to move them to.",
        };
      }
      const name = fullName(person);
      const raised = await AgentPeopleRepository.raiseJobChange(
        organizationId,
        {
          contactId,
          companyId: person.companyId,
          subject: `${name} has moved to ${change.to}`,
          body: [
            [
              `${name} appears to have left ${change.from} for ${change.to}.`,
              change.sourceUrl,
            ]
              .filter(Boolean)
              .join("\n"),
            "Worth a conversation either way: a champion in a new seat is the warmest introduction there is, and their replacement at the old account is a relationship nobody owns yet.",
          ].join("\n\n"),
          meta: {
            source: "job-change",
            from: change.from,
            to: change.to,
            agent: "people-research",
            sessionId: context.sessionId,
          },
          moveToCompanyId: moveToCompanyId ?? null,
        },
      );
      if (!raised)
        return { raised: false as const, reason: "No such contact." };
      return {
        raised: true as const,
        from: change.from,
        to: change.to,
        moved: Boolean(moveToCompanyId),
        ownerNotified: person.ownerId !== null,
      };
    },
  }),
});
