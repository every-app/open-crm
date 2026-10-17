import { z } from "zod";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import type { Evidence } from "./evidence";
import {
  looksLikeSameCompany,
  nameMatchesLocalPart,
  namesMatch,
} from "./names";
import type { Ask } from "./perplexity";

// A contact's X and GitHub profiles, ported from the CRM's lib/socials.ts.
// A search only proposes candidates; nothing is written until a candidate is
// checked against something that identifies the person: a GitHub account's
// own name and company (GitHub's API, raised from 60 lookups an hour by the
// optional GITHUB_TOKEN), or for X, whose profiles cannot be read, a handle
// that is a form of their name plus an independent search citing it.

type Network = "x" | "github";

type SocialProfile = {
  network: Network;
  handle: string;
  url: string;
};

/** The person a candidate profile has to be: as the CRM holds them. */
export type SocialSubject = {
  firstName: string;
  lastName: string | null;
  fullName: string;
  title: string | null;
  companyName: string | null;
  companyDomain: string | null;
};

type Verdict =
  | { accepted: true; profile: SocialProfile; evidence: Evidence[] }
  | { accepted: false; reason: string };

const X_HOSTS = new Set([
  "x.com",
  "www.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
]);
const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);

// Site paths that parse like a username.
const X_RESERVED = new Set([
  "i",
  "home",
  "explore",
  "search",
  "settings",
  "notifications",
  "messages",
  "intent",
  "share",
  "hashtag",
  "status",
  "login",
  "signup",
  "about",
  "privacy",
  "tos",
  "compose",
]);
const GITHUB_RESERVED = new Set([
  "orgs",
  "organizations",
  "features",
  "about",
  "pricing",
  "topics",
  "collections",
  "sponsors",
  "marketplace",
  "settings",
  "login",
  "join",
  "signup",
  "enterprise",
  "apps",
  "explore",
  "trending",
  "security",
  "readme",
  "site",
  "contact",
  "search",
  "new",
  "notifications",
]);

const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const GITHUB_HANDLE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

/** A profile's own page on X or GitHub; null for a deep link or anything else. */
export function parseSocialUrl(raw: string): SocialProfile | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(
      /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
    );
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 1) return null;
  let handle: string;
  try {
    handle = decodeURIComponent(segments[0] ?? "").replace(/^@/, "");
  } catch {
    return null;
  }
  if (X_HOSTS.has(host)) {
    if (X_RESERVED.has(handle.toLowerCase()) || !X_HANDLE.test(handle)) {
      return null;
    }
    return {
      network: "x",
      handle: handle.toLowerCase(),
      url: `https://x.com/${handle}`,
    };
  }
  if (GITHUB_HOSTS.has(host)) {
    if (
      GITHUB_RESERVED.has(handle.toLowerCase()) ||
      !GITHUB_HANDLE.test(handle)
    ) {
      return null;
    }
    return {
      network: "github",
      handle: handle.toLowerCase(),
      url: `https://github.com/${handle}`,
    };
  }
  return null;
}

function extractSocialUrls(haystack: string[]): SocialProfile[] {
  const found: SocialProfile[] = [];
  for (const chunk of haystack) {
    for (const match of chunk.matchAll(
      /https?:\/\/(?:www\.|mobile\.)?(?:x\.com|twitter\.com|github\.com)\/[^\s"'<>)\]},]+/gi,
    )) {
      const profile = parseSocialUrl(match[0].replace(/[.,;:!?]+$/, ""));
      if (profile && !found.some((known) => known.url === profile.url)) {
        found.push(profile);
      }
    }
  }
  return found;
}

const text = z.string().trim().min(1).nullable().catch(null);
const githubAccount = z
  .object({
    login: z.string().nullable().catch(null),
    name: text,
    company: text,
    blog: text,
    bio: text,
    type: z.string().nullable().catch(null),
  })
  .catch({
    login: null,
    name: null,
    company: null,
    blog: null,
    bio: null,
    type: null,
  });

type GithubUser = {
  login: string;
  name: string | null;
  company: string | null;
  blog: string | null;
  bio: string | null;
  type: string;
};

async function fetchGithubUser(
  handle: string,
): Promise<{ ok: true; user: GithubUser } | { ok: false; reason: string }> {
  const headers = new Headers({
    accept: "application/vnd.github+json",
    "user-agent": "open-crm-research-agent",
  });
  const token = await getOptionalEnvValue("GITHUB_TOKEN");
  if (token) headers.set("authorization", `Bearer ${token}`);
  try {
    const response = await fetch(
      `https://api.github.com/users/${encodeURIComponent(handle)}`,
      { headers, signal: AbortSignal.timeout(15_000) },
    );
    if (response.status === 404) {
      return { ok: false, reason: "No such GitHub account." };
    }
    if (response.status === 403 || response.status === 429) {
      return {
        ok: false,
        reason: "GitHub rate-limited the check. Try this contact again later.",
      };
    }
    if (!response.ok) {
      return { ok: false, reason: `GitHub returned HTTP ${response.status}.` };
    }
    const account = githubAccount.parse(await response.json());
    return {
      ok: true,
      user: {
        login: account.login ?? handle,
        name: account.name,
        company: account.company,
        blog: account.blog,
        bio: account.bio,
        type: account.type ?? "User",
      },
    };
  } catch (cause) {
    return {
      ok: false,
      reason: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

/** Checks a GitHub candidate against the account's own profile. */
export async function verifyGithub(
  profile: SocialProfile,
  person: SocialSubject,
): Promise<Verdict> {
  const result = await fetchGithubUser(profile.handle);
  if (!result.ok) return { accepted: false, reason: result.reason };
  const user = result.user;
  if (user.type !== "User") {
    return {
      accepted: false,
      reason: `github.com/${user.login} is an ${user.type.toLowerCase()} account, not a person.`,
    };
  }
  const evidence: Evidence[] = [];
  const named = namesMatch(user.name, person.fullName);
  const employed =
    person.companyName !== null &&
    user.company !== null &&
    looksLikeSameCompany(
      user.company,
      person.companyName,
      person.companyDomain ?? "",
    );
  // One page is one observation: a name and a company that both match are
  // one piece of evidence, not two.
  if (named) {
    evidence.push({
      kind: "github.account-identity",
      detail: employed
        ? `the account is named "${user.name}" and its company reads "${user.company}"`
        : `the account is named "${user.name}"`,
      sourceUrl: profile.url,
    });
  } else if (employed) {
    evidence.push({
      kind: "employer-only",
      detail: `its company reads "${user.company}" but the account is named "${user.name ?? "—"}"`,
      sourceUrl: profile.url,
    });
  }
  const domain = person.companyDomain?.toLowerCase();
  if (
    domain &&
    [user.blog, user.bio].some((field) => field?.toLowerCase().includes(domain))
  ) {
    evidence.push({
      kind: "web.cited-claim",
      detail: `the profile links ${domain}`,
      sourceUrl: profile.url,
    });
  }
  if (nameMatchesLocalPart(person, profile.handle)) {
    evidence.push({
      kind: "handle.name-form",
      detail: `the handle "${profile.handle}" is a form of their name`,
      sourceUrl: profile.url,
    });
  }
  if (evidence.length === 0) {
    return {
      accepted: false,
      reason:
        `github.com/${user.login} says nothing connecting it to ${person.fullName}: ` +
        `name "${user.name ?? "—"}", company "${user.company ?? "—"}".`,
    };
  }
  return { accepted: true, profile, evidence };
}

/**
 * Checks an X candidate: its handle must be a form of their name, not their
 * employer's own account, and an independent search must cite it.
 */
export async function verifyX(
  profile: SocialProfile,
  person: SocialSubject,
  ask: Ask,
): Promise<Verdict> {
  if (
    person.companyName &&
    looksLikeSameCompany(
      profile.handle,
      person.companyName,
      person.companyDomain ?? "",
    )
  ) {
    return {
      accepted: false,
      reason: `x.com/${profile.handle} looks like ${person.companyName}'s own account, not ${person.fullName}'s.`,
    };
  }
  if (!nameMatchesLocalPart(person, profile.handle)) {
    return {
      accepted: false,
      reason:
        `x.com/${profile.handle} is not a form of "${person.fullName}", and X profiles cannot be read to check. ` +
        "Leave it empty.",
    };
  }
  const answer = await ask(
    `Is https://x.com/${profile.handle} the X (Twitter) account of ${describePerson(person)}? ` +
      "Answer yes or no and give the profile URL.",
    { domains: ["x.com", "twitter.com"] },
  );
  if (!answer.ok) {
    return {
      accepted: false,
      reason: `Could not corroborate: ${answer.reason}`,
    };
  }
  const cited = extractSocialUrls(answer.data.citations).some(
    (candidate) =>
      candidate.network === "x" && candidate.handle === profile.handle,
  );
  if (!cited) {
    return {
      accepted: false,
      reason:
        `Nothing retrieved for "${person.fullName}" cites x.com/${profile.handle}. ` +
        "A handle that merely resembles their name is a guess.",
    };
  }
  return {
    accepted: true,
    profile,
    evidence: [
      {
        kind: "handle.name-form",
        detail: `the handle "${profile.handle}" is a form of their name`,
        sourceUrl: profile.url,
      },
      {
        kind: "search.cites-profile",
        detail: `a search for ${person.fullName} cites this profile`,
        sourceUrl: profile.url,
      },
    ],
  };
}

/** Candidate profiles on `network` from a search: leads, never answers. */
export async function findSocialCandidates(
  person: SocialSubject,
  network: Network,
  ask: Ask,
): Promise<{ candidates: SocialProfile[]; citations: string[] }> {
  const where = network === "x" ? "X (Twitter)" : "GitHub";
  const answer = await ask(
    `What is the ${where} profile of ${describePerson(person)}` +
      `${person.companyDomain ? ` (${person.companyDomain})` : ""}? ` +
      "Reply with the profile URL only, or say you do not know.",
    { domains: network === "x" ? ["x.com", "twitter.com"] : ["github.com"] },
  );
  if (!answer.ok) return { candidates: [], citations: [] };
  const candidates = extractSocialUrls([
    answer.data.text,
    ...answer.data.citations,
  ]).filter((candidate) => candidate.network === network);
  return { candidates, citations: answer.data.citations };
}

function describePerson(person: SocialSubject): string {
  return (
    person.fullName +
    (person.title ? `, ${person.title}` : "") +
    (person.companyName ? ` at ${person.companyName}` : "")
  );
}
