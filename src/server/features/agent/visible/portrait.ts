import { z } from "zod";
import { imageStorageReady, storeImage } from "@/server/lib/images";
import {
  extractFromPage,
  personByProfileUrl,
  type ContextFetch,
  type JsonSchema,
} from "../lib/contextDev";
import { namesMatch } from "../lib/names";
import { profileUrlFor, slugFromProfileUrl } from "../lib/people";
import { AgentEnrichmentRepository } from "../repositories/AgentEnrichmentRepository";
import { BILLABLE_CALL_UNITS, type Spend } from "../runtime/budget";
import { contextAccess } from "./brand";

// A contact's photograph, ported from the CRM's lib/portrait.ts and
// lib/portrait-sources.ts. A photograph only ever comes from a source already
// tied to this person, each keyed on an identifier on the record: their
// LinkedIn, their GitHub, their employer's team page. There is no image
// search by name, and there must never be: nobody audits a face.

type PortraitSource = "linkedin" | "github" | "employer-site";

type PortraitResult = {
  stored: boolean;
  imageUrl: string | null;
  source?: PortraitSource;
  reason?: string;
};

type Subject = {
  name: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  companyName: string | null;
  companyDomain: string | null;
};

type Candidate = { source: PortraitSource; url: string };

export const NO_PICTURE_STORAGE =
  "This install has no picture storage, so there is nowhere to keep a copy, and the source URLs expire. Retrying will not help.";

export async function runPortrait(input: {
  organizationId: string;
  contactId: string;
  spend: Spend;
  force?: boolean;
}): Promise<PortraitResult> {
  const { organizationId, contactId } = input;
  const contact = await AgentEnrichmentRepository.contactForPortrait(
    organizationId,
    contactId,
  );
  if (!contact) {
    return { stored: false, imageUrl: null, reason: "No such contact." };
  }
  if (!input.force && contact.imageUrl) {
    return {
      stored: false,
      imageUrl: contact.imageUrl,
      reason: "They already have a photo.",
    };
  }
  const found = await findPortrait(
    {
      name:
        [contact.firstName, contact.lastName].filter(Boolean).join(" ") || null,
      linkedinUrl: contact.linkedinUrl,
      githubUrl: contact.githubUrl,
      companyName: contact.companyName,
      companyDomain: contact.companyDomain,
    },
    input.spend,
    await contextAccess(),
  );
  if (!found.found) {
    return {
      stored: false,
      imageUrl: contact.imageUrl,
      reason:
        found.reason ??
        (found.tried.length > 0
          ? `No picture found. Tried: ${found.tried.join("; ")}.`
          : "Nothing on this contact points at a picture: no LinkedIn or GitHub profile, and no company website."),
    };
  }
  const result = await copyPortrait({
    organizationId,
    contactId,
    current: contact.imageUrl,
    sourceUrl: found.candidate.url,
    force: Boolean(input.force),
  });
  return result.stored ? { ...result, source: found.candidate.source } : result;
}

/**
 * Stores the photograph of a profile already established to be this
 * contact's (get_linkedin_profile, once its verdict says so): into an empty
 * slot only, never over a photo they have.
 */
export async function storePortrait(input: {
  organizationId: string;
  contactId: string;
  sourceUrl: string | null;
}): Promise<PortraitResult> {
  if (!input.sourceUrl) {
    return {
      stored: false,
      imageUrl: null,
      reason: "No photo on the profile.",
    };
  }
  if (!imageStorageReady()) {
    return { stored: false, imageUrl: null, reason: NO_PICTURE_STORAGE };
  }
  const contact = await AgentEnrichmentRepository.contactForPortrait(
    input.organizationId,
    input.contactId,
  );
  if (!contact) {
    return { stored: false, imageUrl: null, reason: "No such contact." };
  }
  if (contact.imageUrl) {
    return {
      stored: false,
      imageUrl: contact.imageUrl,
      reason: "They already have a photo.",
    };
  }
  return copyPortrait({
    organizationId: input.organizationId,
    contactId: input.contactId,
    current: null,
    sourceUrl: input.sourceUrl,
    force: false,
  });
}

/** Copies the photograph into R2 and puts our copy on the contact. */
async function copyPortrait(input: {
  organizationId: string;
  contactId: string;
  current: string | null;
  sourceUrl: string;
  force: boolean;
}): Promise<PortraitResult> {
  const stored = await storeImage(
    input.organizationId,
    `contacts/${input.contactId}/photo`,
    input.sourceUrl,
  );
  if (!stored) {
    return {
      stored: false,
      imageUrl: input.current,
      reason: "The photo could not be fetched. The record is unchanged.",
    };
  }
  if (stored === input.current) {
    return { stored: false, imageUrl: stored, reason: "Unchanged." };
  }
  const written = await AgentEnrichmentRepository.setContactImage(
    input.organizationId,
    input.contactId,
    stored,
    input.force,
  );
  return written
    ? { stored: true, imageUrl: stored }
    : {
        stored: false,
        imageUrl: input.current,
        reason: "Someone gave them a photo meanwhile.",
      };
}

async function findPortrait(
  subject: Subject,
  spend: Spend,
  contextFetch: ContextFetch | null,
): Promise<
  | { found: true; candidate: Candidate }
  | { found: false; tried: string[]; reason?: string }
> {
  const tried: string[] = [];
  const slug = slugFromProfileUrl(subject.linkedinUrl);
  if (slug && !contextFetch) {
    tried.push("Context.dev is not connected, so LinkedIn was not read");
  }
  if (slug && contextFetch) {
    const charge = spend(BILLABLE_CALL_UNITS);
    if (!charge.ok) return { found: false, tried, reason: charge.reason };
    const result = await personByProfileUrl(contextFetch, profileUrlFor(slug));
    if (result.outcome === "found" && result.person.photoUrl) {
      return {
        found: true,
        candidate: { source: "linkedin", url: result.person.photoUrl },
      };
    }
    tried.push(
      result.outcome === "found"
        ? "LinkedIn profile has no picture"
        : "LinkedIn profile could not be read",
    );
  }
  const login = githubLogin(subject.githubUrl);
  if (login) {
    return {
      found: true,
      candidate: {
        source: "github",
        url: `https://github.com/${encodeURIComponent(login)}.png?size=460`,
      },
    };
  }
  if (subject.companyDomain && subject.name && !contextFetch) {
    tried.push(
      "Context.dev is not connected, so the company site was not read",
    );
  }
  if (subject.companyDomain && subject.name && contextFetch) {
    const charge = spend(BILLABLE_CALL_UNITS);
    if (!charge.ok) return { found: false, tried, reason: charge.reason };
    const fromSite = await fromEmployerSite(contextFetch, subject);
    if (fromSite) return { found: true, candidate: fromSite };
    tried.push("Not on the company's own site");
  }
  return { found: false, tried };
}

const TEAM_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    people: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          title: { type: "string" },
          photoUrl: {
            type: "string",
            description: "Absolute URL of this person's headshot.",
          },
        },
        required: ["name"],
      },
    },
  },
  required: ["people"],
};

const teamPage = z
  .object({
    people: z
      .array(
        z
          .object({
            name: z.string().nullable().catch(null),
            photoUrl: z.string().nullable().catch(null),
          })
          .catch({ name: null, photoUrl: null }),
      )
      .catch([]),
  })
  .catch({ people: [] });

async function fromEmployerSite(
  contextFetch: ContextFetch,
  subject: Subject,
): Promise<Candidate | null> {
  const result = await extractFromPage(
    contextFetch,
    `https://${subject.companyDomain}`,
    TEAM_SCHEMA,
    `Find the team, people, about or leadership page for ${subject.companyName ?? subject.companyDomain}. ` +
      "List every named person shown with a headshot, giving the photograph's absolute URL. " +
      "Do not include stock photography, customer logos, or people who are not staff.",
  );
  if (result.outcome !== "found") return null;
  for (const person of teamPage.parse(result.data).people) {
    if (!person.name || !person.photoUrl) continue;
    if (!namesMatch(person.name, subject.name)) continue;
    try {
      const url = new URL(person.photoUrl);
      if (url.protocol === "https:" || url.protocol === "http:") {
        return { source: "employer-site", url: url.toString() };
      }
    } catch {
      // Not a URL; keep looking.
    }
  }
  return null;
}

function githubLogin(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "github.com") return null;
    const segments = url.pathname.split("/").filter(Boolean);
    return segments.length === 1 ? (segments[0] ?? null) : null;
  } catch {
    return null;
  }
}
