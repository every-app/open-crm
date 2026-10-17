import { tool } from "ai";
import { z } from "zod";
import { imageStorageReady } from "@/server/lib/images";
import { recordFact } from "../lib/facts";
import { domainOf, fullName } from "../lib/names";
import { asker, webResearchAccess, type Ask } from "../lib/perplexity";
import {
  findSocialCandidates,
  parseSocialUrl,
  verifyGithub,
  verifyX,
  type SocialSubject,
} from "../lib/socials";
import { unavailable } from "../prompt/capabilities";
import { AgentPeopleRepository } from "../repositories/AgentPeopleRepository";
import { BILLABLE_CALL_UNITS } from "../runtime/budget";
import { NO_PICTURE_STORAGE, runPortrait } from "../visible/portrait";
import type { AgentToolContext, ToolGroup } from "./context";

// A contact's X and GitHub profiles and their photograph, ported from the
// CRM's find_contact_socials, set_contact_socials and fetch_contact_photo. A
// search only ever proposes candidates; set_contact_socials checks each one
// against something that identifies the person and records what it saw
// through the evidence ledger, which is the only way these fields are written.

const SOCIAL_FIELDS = { x: "twitterUrl", github: "githubUrl" } as const;

async function socialSubject(
  context: AgentToolContext,
  contactId: string,
): Promise<SocialSubject | null> {
  const person = await AgentPeopleRepository.subject(
    context.organizationId,
    contactId,
  );
  if (!person) return null;
  return {
    firstName: person.firstName,
    lastName: person.lastName,
    fullName: fullName(person),
    title: person.title,
    companyName: person.companyName,
    // A contact with no company is matched against their address's domain.
    companyDomain:
      person.companyDomain ?? (person.email ? domainOf(person.email) : null),
  };
}

export const socialTools: ToolGroup = (context) => ({
  find_contact_socials: tool({
    description:
      "Search the web for a contact's X and GitHub profiles. Returns CANDIDATES ONLY — pass them to set_contact_socials, which re-checks each one against the account itself before writing. Never write these URLs any other way.",
    inputSchema: z.object({ contactId: z.string() }),
    execute: async ({ contactId }) => {
      const person = await socialSubject(context, contactId);
      if (!person) {
        return { searched: false as const, reason: "No such contact." };
      }
      const research = await webResearchAccess();
      if (!research) {
        return { searched: false as const, ...unavailable("web research") };
      }
      // One search for both networks: one lookup's worth of budget.
      const charge = context.spend(BILLABLE_CALL_UNITS);
      if (!charge.ok)
        return { searched: false as const, reason: charge.reason };
      const ask = asker(research);
      const [x, github] = await Promise.all([
        findSocialCandidates(person, "x", ask),
        findSocialCandidates(person, "github", ask),
      ]);
      await AgentPeopleRepository.stampSocialsChecked(
        context.organizationId,
        contactId,
      );
      return {
        searched: true as const,
        searchedFor: person.fullName,
        candidates: {
          x: x.candidates.map((candidate) => candidate.url),
          github: github.candidates.map((candidate) => candidate.url),
        },
        citations: [...x.citations, ...github.citations],
        note: "Unverified. set_contact_socials will reject any of these it cannot corroborate, and that is a normal outcome.",
      };
    },
  }),

  set_contact_socials: tool({
    description:
      "Write a contact's X and/or GitHub profile URLs after verifying each one. GitHub is checked against the account's own profile via the GitHub API; X is checked by handle and independent citation. Rejects anything it cannot corroborate — a rejection is a correct outcome, not a problem to work around.",
    inputSchema: z.object({
      contactId: z.string(),
      twitterUrl: z
        .string()
        .optional()
        .describe("A candidate x.com profile URL from find_contact_socials."),
      githubUrl: z
        .string()
        .optional()
        .describe(
          "A candidate github.com profile URL from find_contact_socials.",
        ),
    }),
    execute: async ({ contactId, twitterUrl, githubUrl }) => {
      const person = await socialSubject(context, contactId);
      if (!person) {
        return { written: false as const, reason: "No such contact." };
      }
      // Corroborating an X handle is a search: it costs a lookup, and only
      // when a handle gets that far.
      const research = await webResearchAccess();
      const ask: Ask = async (question, options) => {
        if (!research) {
          return { ok: false, reason: "web research is not set up here." };
        }
        const charge = context.spend(BILLABLE_CALL_UNITS);
        if (!charge.ok) return { ok: false, reason: charge.reason };
        return asker(research)(question, options);
      };
      const rejected: string[] = [];
      const outcomes: {
        field: "twitterUrl" | "githubUrl";
        url: string;
        band: string | null;
        applied: boolean;
      }[] = [];
      const candidates = [
        { network: "x" as const, raw: twitterUrl },
        { network: "github" as const, raw: githubUrl },
      ];
      for (const candidate of candidates) {
        if (!candidate.raw) continue;
        const profile = parseSocialUrl(candidate.raw);
        if (profile?.network !== candidate.network) {
          rejected.push(
            `${candidate.raw} is not a ${candidate.network} profile URL.`,
          );
          continue;
        }
        const verdict =
          profile.network === "x"
            ? await verifyX(profile, person, ask)
            : await verifyGithub(profile, person);
        if (!verdict.accepted) {
          rejected.push(verdict.reason);
          continue;
        }
        const field = SOCIAL_FIELDS[profile.network];
        const result = await recordFact(context.organizationId, {
          contactId,
          field,
          value: verdict.profile.url,
          evidence: verdict.evidence,
          method: profile.network === "x" ? "x.handle+citation" : "github.api",
          sourceUrl: verdict.profile.url,
          sessionId: context.sessionId,
        });
        outcomes.push({
          field,
          url: verdict.profile.url,
          band: result.band,
          applied: result.applied,
        });
        if (!result.stored && result.reason) rejected.push(result.reason);
      }
      return {
        written: outcomes.some((outcome) => outcome.applied),
        outcomes,
        rejected,
        note:
          outcomes.length === 0 && rejected.length > 0
            ? "Nothing was written. There is no other route to this write — do not look for one."
            : undefined,
      };
    },
  }),

  fetch_contact_photo: tool({
    description:
      "Find and store a photograph for a contact, from their LinkedIn profile, their GitHub account, or their employer's own team page — whichever is on the record. Never searches for a face by name. Reports which source it used, or what it tried.",
    inputSchema: z.object({
      contactId: z.string(),
      force: z
        .boolean()
        .default(false)
        .describe("Replace an existing photo. Only when a rep asked."),
    }),
    execute: async ({ contactId, force }) => {
      if (!imageStorageReady()) {
        return {
          stored: false as const,
          configured: false as const,
          reason: NO_PICTURE_STORAGE,
        };
      }
      return runPortrait({
        organizationId: context.organizationId,
        contactId,
        spend: context.spend,
        // Replacing a photo is a rep's call: unattended, it never happens.
        force: force && context.attended,
      });
    },
  }),
});
