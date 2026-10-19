import { tool } from "ai";
import { z } from "zod";
import { personByClues, personByProfileUrl } from "../lib/contextDev";
import { verdictFor } from "../lib/identity";
import { profileUrlFor, slugFromProfileUrl } from "../lib/people";
import { asker, webResearchAccess } from "../lib/perplexity";
import { unavailable } from "../prompt/capabilities";
import { AgentPeopleRepository } from "../repositories/AgentPeopleRepository";
import { BILLABLE_CALL_UNITS } from "../runtime/budget";
import { contextAccess } from "../visible/brand";
import { storePortrait } from "../visible/portrait";
import type { ToolGroup } from "./context";
import { untrusted } from "./untrusted";

// People research, ported from the CRM's resolve_linkedin_profile,
// get_linkedin_profile, get_contact_work_history and research_person: a
// person read back from LinkedIn through Context.dev, and cited open-web
// context through Perplexity's Sonar. Each lookup costs the session's budget,
// and only once its source is known to be reachable.

const RESEARCH_SYSTEM =
  "You are researching for a B2B sales rep. Be specific and factual. State only what your sources support, prefer recent information, and say plainly when you do not know. Never speculate about a person.";

export const peopleTools: ToolGroup = (context) => ({
  resolve_linkedin_profile: tool({
    description:
      "Find the person behind a work email address when the CRM holds no LinkedIn URL for them. Sends the name and employer as clues, then returns the profile it resolved with a verdict on whether it is really them. Use get_linkedin_profile instead when the record already carries a LinkedIn URL.",
    inputSchema: z.object({
      email: z.string().describe("The contact's work email address."),
      companyName: z.string().describe("The company the CRM has them at."),
      companyDomain: z
        .string()
        .describe("The company's own domain, for checking the employer."),
      firstName: z
        .string()
        .optional()
        .describe("The first name, if the CRM holds one."),
      lastName: z
        .string()
        .optional()
        .describe("The last name, if the CRM holds one."),
    }),
    execute: async (input) => {
      const contextFetch = await contextAccess();
      if (!contextFetch) {
        return { found: false as const, ...unavailable("Context.dev") };
      }
      const charge = context.spend(BILLABLE_CALL_UNITS);
      if (!charge.ok) return { found: false as const, reason: charge.reason };
      const result = await personByClues(contextFetch, {
        email: input.email,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
        companyName: input.companyName,
        companyDomain: input.companyDomain,
      });
      if (result.outcome !== "found") {
        return { found: false as const, reason: result.reason };
      }
      const person = result.person;
      if (!person.profileUrl) {
        return {
          found: false as const,
          reason:
            "Somebody matched, but no LinkedIn profile came back with them. There is nothing to cite.",
        };
      }
      return {
        found: true as const,
        profile: person,
        sourceUrl: person.profileUrl,
        verdict: verdictFor(person, input),
        note: "One candidate, not proof. Read the verdict before you write anything.",
      };
    },
  }),

  get_linkedin_profile: tool({
    description:
      "Read a LinkedIn profile by slug and check whether it is really the person behind an email address. Returns the profile, their full work history, and an explicit verdict.",
    inputSchema: z.object({
      slug: z
        .string()
        .describe("The linkedin.com/in/<slug> handle, or the profile's URL."),
      email: z.string().describe("The address we are trying to identify."),
      companyName: z.string(),
      companyDomain: z.string(),
      contactId: z
        .string()
        .optional()
        .describe(
          "The CRM contact this candidate is for. Supply it and their photo is copied automatically if — and only if — the profile turns out to be them.",
        ),
    }),
    execute: async ({ slug, contactId, ...claim }) => {
      const contextFetch = await contextAccess();
      if (!contextFetch) {
        return { found: false as const, ...unavailable("Context.dev") };
      }
      const charge = context.spend(BILLABLE_CALL_UNITS);
      if (!charge.ok) return { found: false as const, reason: charge.reason };
      // A whole profile URL in place of its handle is read as its handle.
      const requestedUrl = profileUrlFor(slugFromProfileUrl(slug) ?? slug);
      const result = await personByProfileUrl(contextFetch, requestedUrl);
      if (result.outcome !== "found") {
        return { found: false as const, reason: result.reason };
      }
      const person = result.person;
      const verdict = verdictFor(person, claim);
      // A face is copied only once the profile is established to be theirs.
      const photo =
        contactId && verdict.isSamePerson
          ? await storePortrait({
              organizationId: context.organizationId,
              contactId,
              sourceUrl: person.photoUrl,
            })
          : undefined;
      return {
        found: true as const,
        profile: person,
        sourceUrl: person.profileUrl ?? requestedUrl,
        photo,
        verdict,
      };
    },
  }),

  get_contact_work_history: tool({
    description:
      "Read the LinkedIn profile already on a CRM contact — bio, current role and full work history. For writing a summary of somebody already identified. Cannot be used to identify anyone: use resolve_linkedin_profile and get_linkedin_profile for that.",
    inputSchema: z.object({ contactId: z.string() }),
    execute: async ({ contactId }) => {
      const contextFetch = await contextAccess();
      if (!contextFetch) {
        return { found: false as const, ...unavailable("Context.dev") };
      }
      const person = await AgentPeopleRepository.subject(
        context.organizationId,
        contactId,
      );
      if (!person) return { found: false as const, reason: "No such contact." };
      const slug = slugFromProfileUrl(person.linkedinUrl);
      if (!slug) {
        return {
          found: false as const,
          reason: "This contact has no LinkedIn URL on file.",
        };
      }
      const charge = context.spend(BILLABLE_CALL_UNITS);
      if (!charge.ok) return { found: false as const, reason: charge.reason };
      const profileUrl = profileUrlFor(slug);
      const result = await personByProfileUrl(contextFetch, profileUrl);
      if (result.outcome !== "found") {
        return { found: false as const, reason: result.reason };
      }
      return {
        found: true as const,
        profile: result.person,
        sourceUrl: profileUrl,
        note: "Everything here is self-reported by the person. Write only what it says.",
      };
    },
  }),

  research_person: tool({
    description:
      "Research a person or company on the open web for sales context — recent news, funding, launches, public statements. Returns cited claims. NOT a source of truth for someone's identity or job title; use get_linkedin_profile for that.",
    inputSchema: z.object({
      question: z
        .string()
        .describe(
          "A specific question, e.g. 'What has Acme announced in the last 6 months?'",
        ),
      deep: z
        .boolean()
        .default(false)
        .describe("Reason over more sources. Slower, better for prep briefs."),
    }),
    execute: async ({ question, deep }) => {
      const research = await webResearchAccess();
      if (!research)
        return { ok: false as const, ...unavailable("web research") };
      // A quick question costs 1 unit and a deep one a lookup's 2, as the
      // CRM priced them.
      const charge = context.spend(deep ? BILLABLE_CALL_UNITS : 1);
      if (!charge.ok) return { ok: false as const, reason: charge.reason };
      const answer = await asker(research)(question, {
        deep,
        system: RESEARCH_SYSTEM,
      });
      if (!answer.ok) return { ok: false as const, reason: answer.reason };
      return {
        ok: true as const,
        answer: untrusted(answer.data.text, "web search"),
        citations: answer.data.citations,
        note: "Only write claims that have a citation.",
      };
    },
  }),
});
