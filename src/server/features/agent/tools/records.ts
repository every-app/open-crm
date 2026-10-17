import { tool } from "ai";
import { z } from "zod";
import { PRIORITY, taskSubject } from "@/shared/agent-tasks";
import { hasOrgPermission } from "@/shared/org-permissions";
import { EVIDENCE_KINDS, scoreEvidence } from "../lib/evidence";
import { AgentProfileRepository } from "../repositories/AgentProfileRepository";
import { AgentRecordRepository } from "../repositories/AgentRecordRepository";
import { AgentTaskRepository } from "../repositories/AgentTaskRepository";
import type { ToolGroup } from "./context";

// What the agent writes down: when to look at a contact again, the profile of
// our own business, and a contact's background brief. Ported from the CRM's
// schedule_recheck, write_workspace_profile and write_brief. Each write
// checks its record belongs to the session's organization first.

const MAX_PROFILE_NARRATIVE = 320;
const MAX_PROFILE_LINE = 140;
const MAX_BRIEF_NARRATIVE = 400;
const MIN_NARRATIVE = 40;
const DAY_MS = 24 * 60 * 60 * 1000;

const line = (what: string) =>
  z.string().max(MAX_PROFILE_LINE).optional().describe(what);

function clamp(value: string | undefined, max: number): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

export const recordTools: ToolGroup = (context) => ({
  schedule_recheck: tool({
    description:
      "Decide when this contact is worth looking at again, and say why. Use a short interval for people whose job change would move a live deal, a long one for quiet records, and skip it entirely for addresses nobody will ever sell to.",
    inputSchema: z.object({
      contactId: z.string(),
      days: z
        .number()
        .int()
        .min(1)
        .max(730)
        .describe(
          "14 for a champion on an open deal; 90 for a named contact with no deal; 365 when two attempts have found nothing.",
        ),
      reason: z
        .string()
        .min(10)
        .describe(
          "Why this interval, for this person. A rep reads it: 'a job change here would move the Acme deal', not 'scheduled recheck'.",
        ),
      budget: z
        .number()
        .int()
        .min(1)
        .max(20)
        .default(4)
        .describe(
          "Research units the next run may spend (a vendor call costs 2).",
        ),
    }),
    execute: async ({ contactId, days, reason, budget }) => {
      const exists = await AgentRecordRepository.recordExists(
        context.organizationId,
        {
          kind: "contact",
          id: contactId,
        },
      );
      if (!exists)
        return { scheduled: false as const, reason: "No such contact." };
      const dueAt = new Date(Date.now() + days * DAY_MS).toISOString();
      await AgentTaskRepository.schedule({
        organizationId: context.organizationId,
        contactId,
        kind: "recheck",
        reason,
        dueAt,
        budget,
        priority: PRIORITY.recheck,
        subject: taskSubject({ contactId }),
      });
      return { scheduled: true as const, dueAt, reason };
    },
  }),

  write_workspace_profile: tool({
    description:
      "Write the short profile of the company we work for. Every other session opens with it, so it is deliberately small: a few sentences and three one-line facts. Replaces the previous one.",
    inputSchema: z.object({
      narrative: z
        .string()
        .max(MAX_PROFILE_NARRATIVE)
        .describe(
          "Two or three sentences a new colleague would need on their first day: what this company does and how it makes money. Plain, factual, no adjectives from the marketing site.",
        ),
      sells: line(
        'What we sell, in a few words. e.g. "Compliance automation for SOC 2, ISO 27001 and GDPR"',
      ),
      sellsTo: line(
        'Who we sell it to. e.g. "Series A–C startups that need a framework audit"',
      ),
      edge: line(
        "What customers pick us over the alternatives for, if the site says.",
      ),
      sourceUrl: z.string().optional(),
    }),
    execute: async (input) => {
      // Every session's prompt opens with the profile, so in a chat only an
      // owner or admin may have it rewritten; the workspace-profile task
      // writes it unattended from the website.
      if (
        context.attended &&
        !(
          context.role &&
          hasOrgPermission(context.role, { workspace: ["manage"] })
        )
      ) {
        return {
          written: false as const,
          reason:
            "Only an owner or admin can change the company profile. Tell the rep what you would change and let them ask an admin.",
        };
      }
      const us = await AgentProfileRepository.workspaceIdentity(
        context.organizationId,
      );
      if (!us?.website) {
        return {
          written: false as const,
          reason:
            "This install has not been told its own website, so there is nothing to file a profile against.",
        };
      }
      const narrative = input.narrative.trim();
      if (narrative.length < MIN_NARRATIVE) {
        return {
          written: false as const,
          reason:
            "Too short to tell anybody anything. Say what we sell and to whom, or say nothing.",
        };
      }
      const sections = {
        sells: clamp(input.sells, MAX_PROFILE_LINE),
        sellsTo: clamp(input.sellsTo, MAX_PROFILE_LINE),
        edge: clamp(input.edge, MAX_PROFILE_LINE),
      };
      const kept = Object.fromEntries(
        Object.entries(sections).filter(([, value]) => value !== undefined),
      );
      await AgentProfileRepository.writeWorkspaceProfile(
        context.organizationId,
        {
          website: us.website,
          narrative: clamp(narrative, MAX_PROFILE_NARRATIVE) ?? narrative,
          sections: kept,
          sourceUrl: input.sourceUrl ?? null,
          sessionId: context.sessionId,
        },
      );
      return {
        written: true as const,
        website: us.website,
        narrative,
        sections: kept,
      };
    },
  }),

  write_brief: tool({
    description:
      "Write the Background panel on a contact: a short narrative plus the structured lines under it. Replaces the previous one. Every claim must come from something you read.",
    inputSchema: z.object({
      contactId: z.string(),
      narrative: z
        .string()
        .max(MAX_BRIEF_NARRATIVE)
        .describe(
          "Two or three sentences, third person, present tense, their name first. Current role and employer, then the previous roles worth knowing. No adjectives about the person, no 'passionate about', no guessing at seniority.",
        ),
      sections: z.object({
        currentRole: z
          .string()
          .optional()
          .describe('e.g. "CEO & Co-founder · Comp AI"'),
        tenure: z.string().optional().describe('e.g. "2 yrs 3 mos"'),
        previousRoles: z.array(z.string()).optional(),
        seniority: z.string().optional().describe('e.g. "Founder / C-level"'),
        function: z
          .string()
          .optional()
          .describe('e.g. "Executive", "Security", "Finance"'),
        location: z.string().optional(),
      }),
      evidence: z
        .array(
          z.object({
            kind: z.enum(EVIDENCE_KINDS),
            detail: z.string(),
            sourceUrl: z.string().optional(),
          }),
        )
        .min(1),
      sourceUrl: z.string().optional(),
    }),
    execute: async (input) => {
      const narrative = input.narrative.trim();
      if (narrative.length < MIN_NARRATIVE) {
        return {
          written: false as const,
          reason:
            "Too short to be worth a panel. Say something the record does not already show, or write nothing.",
        };
      }
      const scored = scoreEvidence(input.evidence);
      if (scored.band === null) {
        return {
          written: false as const,
          reason: "Nothing here is sourced well enough to put on the record.",
        };
      }
      const score = Math.round(scored.score * 100) / 100;
      const written = await AgentProfileRepository.writeContactBrief(
        context.organizationId,
        {
          contactId: input.contactId,
          narrative,
          sections: input.sections,
          score,
          sourceUrl: input.sourceUrl ?? null,
          sessionId: context.sessionId,
        },
      );
      return written
        ? { written: true as const, score }
        : { written: false as const, reason: "No such contact." };
    },
  }),
});
