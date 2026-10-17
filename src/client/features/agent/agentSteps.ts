import { z } from "zod";
import { safeHostname, safeHttpUrl } from "@/shared/safe-url";
import { ASK_QUESTION } from "./askQuestion";

// How the Agent tab words what the agent did, ported from the CRM's
// lib/agent-transcript.ts. Every tool call is a step: what it did, and why
// when the tool says, toned by its outcome, with the sources it read. A step
// that came to nothing says why ("the profile lists another address"): those
// are the leads the agent threw away, the steps a rep trusts it by.

export type Tone = "neutral" | "success" | "warning";

export type Source = {
  url: string;
  title: string;
  network: "linkedin" | "github" | "web";
};

export type Step = { label: string; tone: Tone; sources: Source[] };

const VERBS: Record<string, string> = {
  read_crm_history: "Read our emails and meetings with them",
  read_company_history: "Read everything we have on the company",
  read_deal_history: "Read the deal and where it has been",
  search_crm: "Looked the record up in the CRM",
  resolve_linkedin_profile: "Searched for their LinkedIn profile",
  get_linkedin_profile: "Read a LinkedIn profile",
  get_contact_work_history: "Read their work history",
  fetch_contact_photo: "Fetched their profile picture",
  find_contact_socials: "Searched for their other profiles",
  set_contact_socials: "Checked a profile against the account itself",
  identify_contact: "Put a name to the address",
  record_fact: "Recorded what it found",
  write_brief: "Wrote the background",
  write_workspace_profile: "Wrote up who we are",
  research_person: "Researched them on the web",
  research_company: "Read the company's site",
  enrich_company: "Looked up the company",
  schedule_recheck: "Decided when to look again",
  record_job_change: "Raised a job change",
  list_deals: "Reviewed the deal pipeline",
  list_outstanding_work: "Looked for outstanding work",
  set_chat_title: "Named this chat",
  list_fields: "Read what this workspace tracks",
  set_field_value: "Filled in a custom field",
  manage_fields: "Changed what the CRM tracks",
  archive_field: "Asked to retire a field",
  activate_skill: "Read its instructions for this",
  read_skill_resource: "Read its instructions for this",
  web_search: "Searched the web",
  web_fetch: "Read a web page",
  [ASK_QUESTION]: "Asked a question",
};

/** What a tool did, in words: "Read a web page". */
export function toolVerb(tool: string): string {
  const verb = VERBS[tool];
  if (verb) return verb;
  const words = tool.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const flag = z.boolean().nullable().catch(null);
const text = z.string().trim().min(1).nullable().catch(null);

// The fields the agent's tools report outcomes in. A tool that threw comes
// back as `{ error }` (the registry hands failures to the model to work
// around).
const outcomeSchema = z
  .object({
    reason: text,
    error: text,
    applied: flag,
    written: flag,
    stored: flag,
    sourceUrl: text,
    profileUrl: text,
    url: text,
  })
  .nullable()
  .catch(null);

function sourcesOf(outcome: z.infer<typeof outcomeSchema>): Source[] {
  if (!outcome) return [];
  const urls = new Set(
    [outcome.sourceUrl, outcome.profileUrl, outcome.url].flatMap((value) => {
      const url = safeHttpUrl(value);
      return url ? [url] : [];
    }),
  );
  return [...urls].map((url) => {
    const title = safeHostname(url) ?? url;
    return {
      url,
      title,
      network: title.includes("linkedin")
        ? "linkedin"
        : title.includes("github")
          ? "github"
          : "web",
    };
  });
}

/**
 * One tool call as a step. `failed` when the call itself broke (an
 * `output-error` part, a `tool.failed` event).
 */
export function describeStep(
  tool: string,
  result: { output?: unknown; failed?: boolean },
): Step {
  const outcome = outcomeSchema.parse(result.output);
  const verb = toolVerb(tool);
  const reason = outcome?.reason ?? outcome?.error ?? null;
  const tone: Tone =
    result.failed || outcome?.error
      ? "warning"
      : outcome?.applied === true || outcome?.written === true
        ? "success"
        : outcome?.stored === false || outcome?.written === false
          ? "warning"
          : "neutral";
  return {
    label: reason ? `${verb} — ${reason}` : verb,
    tone,
    sources: sourcesOf(outcome),
  };
}
