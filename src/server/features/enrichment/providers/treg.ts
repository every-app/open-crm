import { z } from "zod";
import {
  linkedinHandle,
  linkedinProfileUrl,
  type CompanyClues,
  type CompanyFacts,
  type Lookup,
  type PersonClues,
  type PersonFacts,
} from "./facts";
import type { ProviderFetch } from "./gateway";
import { failureReason, postJson, type Answer } from "./http";

// Treg (treg.to): one token over many people and company data vendors, paid
// per lookup. Its routed tools take what the CRM knows, try vendors cheapest
// first until one has a match, and answer in one shape whichever served:
// `{ output, raw, _treg }`. No photographs and no logos.

const API = "https://treg.to/call";
const NAME = "Treg";

// The most one lookup may cost, in USD, across every vendor Treg tries for
// it. Treg's own default is $1.
const PERSON_MAX_COST = "0.10";
const COMPANY_MAX_COST = "0.05";

const text = z.string().trim().min(1).nullable().catch(null);

const personOutput = z.object({
  output: z.object({ full_name: text, title: text, linkedin_url: text }),
});

const companyOutput = z.object({
  output: z.object({
    name: text,
    description: text,
    industry: text,
    linkedin_url: text,
  }),
});

const errorBody = z.object({ error: z.string() }).catch({ error: "" });

/**
 * Tags the call with the organization, so a Treg account shared by several
 * can be reconciled from Treg's ledger. Treg refuses a tag outside these
 * characters, so one that doesn't fit is left off.
 */
function headers(organizationId: string, maxCost: string) {
  return {
    "X-Treg-Route-Max-Cost": maxCost,
    ...(/^[\w.:-]{1,128}$/.test(organizationId)
      ? { "X-Treg-Meta": `workspace=${organizationId}` }
      : {}),
  };
}

function failure(answer: Extract<Answer, { ok: false }>): Lookup<never> {
  // Treg's own refusals name the account's balance or a top-up link, so only
  // their code is read.
  const code = errorBody.parse(answer.body).error;
  if (answer.status === 422) {
    return {
      outcome: "skipped",
      reason: `${NAME} could not use what the record has.`,
    };
  }
  if (code === "route_max_cost") {
    return {
      outcome: "skipped",
      reason: `${NAME} found no match within the CRM's price limit for one lookup.`,
    };
  }
  if (answer.status === 402 || code === "funds_required") {
    return { outcome: "failed", reason: `The ${NAME} balance has run out.` };
  }
  return { outcome: "failed", reason: failureReason(NAME, answer) };
}

async function person(
  fetcher: ProviderFetch,
  clues: PersonClues,
  organizationId: string,
): Promise<Lookup<PersonFacts>> {
  const handle = linkedinHandle(clues.linkedinUrl);
  const email = clues.email?.trim() || null;
  const domain = clues.companyDomain?.trim() || null;
  if (!handle && !email && !domain) {
    return {
      outcome: "skipped",
      reason:
        "No email address, LinkedIn profile or company website to look up.",
    };
  }
  // Treg sends each vendor only the identifiers it takes.
  const answer = await postJson(
    fetcher,
    `${API}/treg.people.enrich`,
    {
      ...(email ? { email } : {}),
      ...(handle ? { linkedin_url: linkedinProfileUrl(handle) } : {}),
      ...(domain
        ? {
            domain,
            first_name: clues.firstName.trim(),
            ...(clues.lastName?.trim()
              ? { last_name: clues.lastName.trim() }
              : {}),
          }
        : {}),
    },
    headers(organizationId, PERSON_MAX_COST),
  );
  if (!answer.ok) return failure(answer);
  const parsed = personOutput.safeParse(answer.body);
  // A miss is a 200 with no name.
  if (!parsed.success || !parsed.data.output.full_name) {
    return { outcome: "skipped", reason: `${NAME} has no match.` };
  }
  const { title, linkedin_url: profile } = parsed.data.output;
  const found = linkedinHandle(profile);
  return {
    outcome: "found",
    facts: {
      ...(title ? { title } : {}),
      ...(found ? { linkedinUrl: linkedinProfileUrl(found) } : {}),
    },
  };
}

async function company(
  fetcher: ProviderFetch,
  clues: CompanyClues,
  organizationId: string,
): Promise<Lookup<CompanyFacts>> {
  const domain = clues.domain?.trim() || null;
  const linkedin = companyLinkedinUrl(clues.linkedinUrl);
  if (!domain && !linkedin) {
    return {
      outcome: "skipped",
      reason: "No domain to look up. Add the company's website first.",
    };
  }
  const answer = await postJson(
    fetcher,
    `${API}/treg.companies.enrich`,
    {
      ...(domain ? { domain } : {}),
      ...(linkedin ? { linkedin_url: linkedin } : {}),
    },
    headers(organizationId, COMPANY_MAX_COST),
  );
  if (!answer.ok) return failure(answer);
  const parsed = companyOutput.safeParse(answer.body);
  if (!parsed.success || !parsed.data.output.name) {
    return { outcome: "skipped", reason: `${NAME} has no match.` };
  }
  const {
    name,
    description,
    industry,
    linkedin_url: page,
  } = parsed.data.output;
  const foundPage = companyLinkedinUrl(page);
  return {
    outcome: "found",
    facts: {
      name,
      ...(description ? { description } : {}),
      ...(industry ? { industry } : {}),
      ...(foundPage ? { linkedinUrl: foundPage } : {}),
    },
  };
}

/** A LinkedIn company page's URL, or null: Treg refuses a URL field holding anything else. */
function companyLinkedinUrl(raw: string | null): string | null {
  const typed = raw?.trim();
  if (!typed) return null;
  try {
    const url = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`,
    );
    const host = url.hostname.toLowerCase();
    if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return null;
    const [section, handle] = url.pathname.split("/").filter(Boolean);
    if (section !== "company" || !handle) return null;
    return `https://www.linkedin.com/company/${handle}`;
  } catch {
    return null;
  }
}

export const TregProvider = { person, company };
