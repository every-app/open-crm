// The research agent's task kinds and priorities, shared by the code that
// queues work (records, fields, the workspace) and the dispatcher that runs it.

export const TASK_KINDS = [
  "brand",
  "portrait",
  "meeting-prep",
  "identify",
  "profile",
  "recheck",
  "company-profile",
  "workspace-profile",
  "field-backfill",
  "agent-event",
] as const;

export type TaskKind = (typeof TASK_KINDS)[number];

/**
 * A CRM event waiting to become team agent runs (the CRM's agent-event task).
 * It is written in the same batch as the record write that caused it, and the
 * team-agent lane turns it into runs (TriggerService), never research.
 */
export const AGENT_EVENT_KIND = "agent-event" satisfies TaskKind;

/**
 * Reading the connected Slack workspace's people and channels (the CRM's
 * slack-people-match): about the workspace, not a record, so never shown in
 * the agent's queue (SlackSyncService).
 */
export const SLACK_SYNC_KIND = "slack-sync";

/**
 * Kinds the dispatcher runs without a model (the "visible" lane): they fill
 * in what a person is looking at right now, so they go first and fast.
 */
export const DIRECT_KINDS = ["brand", "portrait", SLACK_SYNC_KIND] as const;

/** Kinds that cost nothing, so they never wait for credits. */
export const FREE_KINDS = [SLACK_SYNC_KIND] as const;

/** Kinds whose progress is the contact's enrichment status. */
const CONTACT_STATUS_KINDS = ["identify", "profile", "recheck"] as const;

/** Kinds whose progress is the company's enrichment status. */
const COMPANY_STATUS_KINDS = ["brand"] as const;

export function ownsContactStatus(kind: string): boolean {
  return (CONTACT_STATUS_KINDS as readonly string[]).includes(kind);
}

export function ownsCompanyStatus(kind: string): boolean {
  return (COMPANY_STATUS_KINDS as readonly string[]).includes(kind);
}

export const MAX_ATTEMPTS = 3;

export const RETIRED_OUTCOME = `Gave up after ${MAX_ATTEMPTS} attempts: the session never reported back.`;

export const PRIORITY = {
  brand: 900,
  portrait: 800,
  // Logos for records a CSV brought in: after a person's own adds.
  importedBrand: 700,
  workspace: 500,
  requested: 300,
  meeting: 200,
  identify: 100,
  sweep: 50,
  companyProfile: 40,
  fieldBackfill: 20,
  // Research for records a CSV brought in, spaced out (AgentTaskService).
  imported: 10,
  recheck: 0,
  event: 700,
  slackSync: 150,
} as const;

/**
 * Research at or above this priority is work a person asked for (their
 * workspace's website, an "enrich now"), which runs even where a first-party
 * deployment holds its scheduled research (deployment-tier.ts).
 */
export const ASKED_FOR_PRIORITY = PRIORITY.requested;

/** The subject a task is about: at most one open task of a kind per subject. */
export function taskSubject(record: {
  contactId?: string | null;
  companyId?: string | null;
  dealId?: string | null;
}): string {
  if (record.contactId) return `contact:${record.contactId}`;
  if (record.companyId) return `company:${record.companyId}`;
  if (record.dealId) return `deal:${record.dealId}`;
  return "workspace";
}
