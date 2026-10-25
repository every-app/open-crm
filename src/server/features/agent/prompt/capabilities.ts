import { webResearchAvailable } from "../lib/perplexity";
import { hasContextAccess } from "@/server/lib/provider-access";
import { getEnvValueSync } from "@/server/lib/runtime-env";

// What this install can reach, ported from the CRM's lib/capabilities.ts.
// Every session states it, so the agent plans around what it has: a missing
// key removes a place to look, and is never an error. The keys themselves live
// with the Every App gateway (Context.dev, OpenRouter for web research) or in the CRM's own
// optional GITHUB_TOKEN secret.

export type Capability = {
  label: string;
  gives: string;
  enabled: boolean;
};

type InstallCapabilities = {
  context: boolean;
  webResearch: boolean;
  pictures: boolean;
  githubToken: boolean;
};

/** Reads what the install has. Never throws: a failed check is "not here". */
export async function readCapabilities(
  env: object,
  organizationId: string,
): Promise<InstallCapabilities> {
  const context = await hasContextAccess().catch((error: unknown) => {
    console.warn("[agent] could not check Context.dev", error);
    return false;
  });
  let webResearch = false;
  try {
    webResearch = webResearchAvailable(env, organizationId);
  } catch {
    webResearch = false;
  }
  return {
    context,
    webResearch,
    pictures: Boolean(Reflect.get(env, "R2")),
    githubToken: Boolean(getEnvValueSync(env, "GITHUB_TOKEN")),
  };
}

export function capabilityList(install: InstallCapabilities): Capability[] {
  return [
    {
      label: "Web research",
      gives:
        "open-web context with citations, and the search that finds a LinkedIn slug in the first place",
      enabled: install.webResearch,
    },
    {
      label: "Company brand data",
      gives: "a company's logo, industry, location and socials from its domain",
      enabled: install.context,
    },
    {
      label: "LinkedIn",
      gives:
        "a person read back from a LinkedIn URL you already hold — their real name, bio, current title and employer, every earlier role with its dates, their education and their other public profiles, all self-reported and so authoritative on identity",
      enabled: install.context,
    },
    {
      label: "Picture storage",
      gives:
        "somewhere to keep a logo or a profile photo. Without it a record has no picture at all, because the URLs these sources hand back expire and are never stored as they are",
      enabled: install.pictures,
    },
    {
      label: install.githubToken
        ? "GitHub profiles"
        : "GitHub profiles (no GITHUB_TOKEN, so about 60 lookups an hour)",
      gives:
        "a person's public GitHub account: the name, employer, location and bio they gave it",
      enabled: true,
    },
  ];
}

/**
 * A tool's answer when the install lacks the source it needs, checked before
 * any budget is spent: a missing key removes a place to look, and is never
 * an error.
 */
export function unavailable(source: string) {
  return {
    configured: false as const,
    reason: `This install has no ${source}, so that source is unavailable. This is not a failure and retrying will not help — use what the CRM already knows, and say in your write-up what you could not check.`,
  };
}

export function capabilitiesMarkdown(all: readonly Capability[]): string {
  const on = all.filter((capability) => capability.enabled);
  const off = all.filter((capability) => !capability.enabled);
  const lines = ["## What you can use here", ""];
  if (on.length === 0) {
    lines.push(
      "No outside sources are configured on this install. Everything you can",
      "learn is already in the CRM — email threads, meetings, signature",
      "blocks — and `read_crm_history` reads all of it for free. That is",
      "often enough to settle who somebody is. Record what it shows, and",
      "leave the rest empty.",
    );
    return lines.join("\n");
  }
  lines.push("Available:");
  for (const capability of on) {
    lines.push(`- **${capability.label}** — ${capability.gives}.`);
  }
  if (off.length > 0) {
    lines.push("", "Not configured here, so do not plan around them:");
    for (const capability of off) lines.push(`- ${capability.label}`);
    lines.push(
      "",
      "Their tools will tell you the same thing if you call them. Note what",
      "you could not check rather than guessing at it.",
    );
  }
  return lines.join("\n");
}
