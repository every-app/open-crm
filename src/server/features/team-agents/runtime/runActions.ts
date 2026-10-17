import { ActivityRepository } from "@/server/features/activities/repositories/ActivityRepository";
import { AgentAccountRepository } from "@/server/features/agent/repositories/AgentAccountRepository";
import { AgentDealRepository } from "@/server/features/agent/repositories/AgentDealRepository";
import { AgentHistoryRepository } from "@/server/features/agent/repositories/AgentHistoryRepository";
import { AgentLookupRepository } from "@/server/features/agent/repositories/AgentLookupRepository";
import { searchCrm } from "@/server/features/agent/tools/lookup";
import { SlackError } from "@/server/features/slack/lib/slackApi";
import { SlackService } from "@/server/features/slack/services/SlackService";
import { RECORD_KINDS, type RecordKind } from "@/shared/records";
import {
  AGENT_ACTION_TYPES,
  agentManifest,
  recordResources,
  SLACK_RESOURCE,
  slackDestinationOf,
  type AgentManifest,
  type RecordResource,
} from "@/shared/team-agents";
import {
  AgentRunRepository,
  type ActionRow,
} from "../repositories/AgentRunRepository";
import { BuilderRepository } from "../repositories/BuilderRepository";
import { AgentRunService } from "../services/AgentRunService";

// What a team agent's run may do, ported from the CRM's run-runtime.ts. Each
// function re-reads the run and its pinned version and enforces the version's
// grants itself, whatever the model asked: records only inside the approved
// scope, activities only of a granted type, Slack only to the one approved
// destination, and nothing at all once the run is no longer RUNNING. Every
// side effect is a row in the action ledger before it happens, keyed by the
// run and the model's tool call, so a replayed call finds what it already did.

const ACTION_LEASE_MS = 5 * 60_000;

export class RunRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunRefusal";
  }
}

type Scope = { mode: "SELECTED" | "WORKSPACE"; records: RecordResource[] };

/** The manifest, or a refusal: a run never guesses at what it may do. */
function readManifest(value: unknown): AgentManifest {
  const parsed = agentManifest.safeParse(value);
  if (!parsed.success) {
    throw new RunRefusal(
      "This version's manifest is unreadable, so it cannot run. Revise and deploy the agent again.",
    );
  }
  return parsed.data;
}

/** The version's record scope, failing closed on a contradictory one. */
function scopeOf(manifest: AgentManifest): Scope {
  const records = recordResources(manifest.dataScope.resources);
  if (manifest.dataScope.mode === "SELECTED" && records.length === 0) {
    throw new RunRefusal("This version selected no CRM records.");
  }
  if (manifest.dataScope.mode === "WORKSPACE" && records.length > 0) {
    throw new RunRefusal("This version mixes workspace and selected scope.");
  }
  return { mode: manifest.dataScope.mode, records };
}

function inScope(scope: Scope, kind: RecordKind, id: string): boolean {
  return (
    scope.mode === "WORKSPACE" ||
    scope.records.some((record) => record.kind === kind && record.id === id)
  );
}

/** The run, while it is RUNNING, with its version's manifest and scope. */
async function activeRun(organizationId: string, runId: string) {
  const run = await AgentRunRepository.findWithVersion(organizationId, runId);
  if (!run) throw new RunRefusal("This agent run is unavailable.");
  if (run.status !== "RUNNING") {
    throw new RunRefusal("This agent run is not active.");
  }
  const manifest = readManifest(run.manifest);
  return { run, manifest, scope: scopeOf(manifest) };
}

/** What inspect_run returns: the pinned version, trigger, grants and time. */
async function runContext(organizationId: string, runId: string) {
  const { run, manifest, scope } = await activeRun(organizationId, runId);
  return {
    run: { id: run.id, triggerType: run.triggerType, input: run.input },
    agent: { name: run.agentName, description: run.agentDescription },
    version: { number: run.versionNumber },
    triggers: manifest.triggers,
    recordScope: scope.mode,
    allowedRecords: scope.records,
    allowedActions: manifest.actions,
    now: new Date().toISOString(),
  };
}

/** Search inside the approved scope. */
async function queryCrm(
  organizationId: string,
  runId: string,
  input: { query: string; kinds?: RecordKind[]; limit: number },
) {
  const { scope } = await activeRun(organizationId, runId);
  const result = await searchCrm(
    { organizationId },
    input.query,
    input.kinds ?? [...RECORD_KINDS],
    input.limit,
  );
  if (scope.mode === "WORKSPACE") return result;
  const contacts = result.contacts.filter((row) =>
    inScope(scope, "contact", row.id),
  );
  const companies = result.companies.filter((row) =>
    inScope(scope, "company", row.id),
  );
  const deals = result.deals.filter((row) => inScope(scope, "deal", row.id));
  return {
    ...result,
    contacts,
    companies,
    deals,
    total: contacts.length + companies.length + deals.length,
  };
}

/** Deals by pipeline status and inactivity, inside the approved scope. */
async function listDeals(
  organizationId: string,
  runId: string,
  input: {
    status: "open" | "won" | "lost" | "all";
    inactiveForDays?: number;
    limit: number;
    offset: number;
  },
) {
  const { scope } = await activeRun(organizationId, runId);
  const now = new Date();
  const rows = await AgentLookupRepository.listDeals(
    organizationId,
    input,
    now,
  );
  const hasMore = rows.length > input.limit;
  const deals = rows
    .slice(0, input.limit)
    .filter((row) => inScope(scope, "deal", row.id))
    .map((row) => ({
      id: row.id,
      name: row.name,
      stage: row.stage,
      amount: row.amount,
      currency: row.currency,
      company: { id: row.companyId, name: row.companyName },
      owner: row.ownerName ?? row.ownerEmail,
      lastActivityAt: row.lastActivityAt,
      expectedCloseDate: row.expectedCloseDate,
      createdAt: row.createdAt,
    }));
  return {
    asOf: now.toISOString(),
    deals,
    nextOffset: hasMore ? input.offset + input.limit : null,
  };
}

/**
 * One record and its CRM history, inside the approved scope. Email and
 * calendar history are left out: no version can grant them yet.
 */
async function readRecord(
  organizationId: string,
  runId: string,
  input: { kind: RecordKind; id: string },
) {
  const { scope } = await activeRun(organizationId, runId);
  if (!inScope(scope, input.kind, input.id)) {
    throw new RunRefusal(
      "That CRM record is outside this agent version's approved scope.",
    );
  }
  const history =
    input.kind === "contact"
      ? await AgentHistoryRepository.contactHistory(organizationId, input.id, {
          threads: 0,
        })
      : input.kind === "company"
        ? await AgentAccountRepository.companyHistory(organizationId, input.id, {
            threads: 0,
            people: 50,
          })
        : await AgentDealRepository.dealHistory(organizationId, input.id, {
            threads: 0,
          });
  if (!history) return { found: false as const, reason: "No such record." };
  const {
    threads: _threads,
    meetings: _meetings,
    stats: _stats,
    ...rest
  } = history as typeof history & {
    threads?: unknown;
    meetings?: unknown;
    stats?: unknown;
  };
  return { found: true as const, ...rest };
}

async function sha256(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

type Claim =
  | { claimed: false; action: ActionRow }
  | { claimed: true; action: ActionRow; claimedAt: string };

/**
 * The ledger entry for this run and call: the one already there (whose
 * request must be the same), or a new one, claimed to be performed now. A
 * succeeded entry is never performed again.
 */
async function claim(
  organizationId: string,
  input: Omit<
    Parameters<typeof AgentRunRepository.planAction>[0],
    "organizationId" | "idempotencyKey" | "requestHash"
  > & { callId: string; request: unknown },
): Promise<Claim> {
  const idempotencyKey = `${input.runId}:${input.callId}`;
  const requestHash = await sha256(input.request);
  const { callId: _callId, request: _request, ...values } = input;
  const action = await AgentRunRepository.planAction({
    ...values,
    organizationId,
    idempotencyKey,
    requestHash,
  });
  if (action.requestHash !== requestHash) {
    throw new RunRefusal(
      "That agent action call was already used for other input.",
    );
  }
  if (action.status === "SUCCEEDED") return { claimed: false, action };
  const claimedAt = await AgentRunRepository.claimAction(
    organizationId,
    action.id,
    ACTION_LEASE_MS,
  );
  if (claimedAt) return { claimed: true, action, claimedAt };
  const current = await AgentRunRepository.findAction(
    organizationId,
    idempotencyKey,
  );
  if (current?.status === "SUCCEEDED") return { claimed: false, action: current };
  throw new RunRefusal("This agent action is already in progress.");
}

async function fail(
  organizationId: string,
  claimed: Extract<Claim, { claimed: true }>,
  code: string,
  error: unknown,
): Promise<never> {
  const message = error instanceof Error ? error.message : String(error);
  await AgentRunRepository.finishAction(
    organizationId,
    claimed.action.id,
    claimed.claimedAt,
    { status: "FAILED", errorCode: code, errorMessage: message },
  );
  throw error;
}

async function targetRecord(
  organizationId: string,
  kind: RecordKind,
  id: string,
) {
  const company = await ActivityRepository.recordCompany(organizationId, {
    kind,
    id,
  });
  if (!company) return null;
  const [described] = await BuilderRepository.describeRecords(organizationId, [
    { kind, id },
  ]);
  return {
    label: described?.label ?? id,
    companyId: company.companyId,
    contactId: kind === "contact" ? id : null,
    dealId: kind === "deal" ? id : null,
  };
}

/**
 * Writes a note or task on a record: only a type the version grants, only on
 * a record in its scope, once per tool call.
 */
async function createActivity(
  organizationId: string,
  runId: string,
  callId: string,
  input: {
    type: "NOTE" | "TASK";
    targetKind: RecordKind;
    targetId: string;
    subject?: string | null;
    body?: string | null;
    dueAt?: string | null;
  },
) {
  const { run, manifest, scope } = await activeRun(organizationId, runId);
  const granted = manifest.actions.some(
    (action) =>
      action.type === AGENT_ACTION_TYPES.CRM_ACTIVITY_CREATE &&
      action.activityTypes.includes(input.type),
  );
  if (!granted) {
    throw new RunRefusal(
      `This agent version does not allow CRM ${input.type.toLowerCase()} activities.`,
    );
  }
  if (!inScope(scope, input.targetKind, input.targetId)) {
    throw new RunRefusal(
      "That CRM record is outside this agent version's approved scope.",
    );
  }
  const subject = input.subject?.trim() || null;
  const body = input.body?.trim() || null;
  if (input.type === "TASK" && !subject) {
    throw new RunRefusal("A CRM task needs a subject.");
  }
  if (input.type === "NOTE" && !subject && !body) {
    throw new RunRefusal("A CRM note needs a subject or body.");
  }
  const dueAt = input.dueAt ? new Date(input.dueAt) : null;
  if (dueAt && Number.isNaN(dueAt.getTime())) {
    throw new RunRefusal("The due date is invalid.");
  }
  const target = await targetRecord(
    organizationId,
    input.targetKind,
    input.targetId,
  );
  if (!target) throw new RunRefusal("That CRM record no longer exists.");
  const claimed = await claim(organizationId, {
    agentId: run.agentId,
    runId,
    callId,
    request: {
      type: input.type,
      targetKind: input.targetKind,
      targetId: input.targetId,
      subject,
      body,
      dueAt: input.dueAt?.trim() || null,
    },
    type: AGENT_ACTION_TYPES.CRM_ACTIVITY_CREATE,
    provider: "crm",
    targetType: input.targetKind,
    targetId: input.targetId,
    targetLabel: target.label,
    summary:
      subject ?? `Create a ${input.type.toLowerCase()} on ${target.label}`,
    metadata: { activityType: input.type },
  });
  if (!claimed.claimed) {
    return {
      actionId: claimed.action.id,
      activityId: claimed.action.externalId,
      replayed: true,
    };
  }
  const activityId = `agent-action-${claimed.action.id}`;
  try {
    if (!(await AgentRunRepository.holdsAction(organizationId, claimed.action.id, claimed.claimedAt))) {
      throw new RunRefusal("This agent run is not active.");
    }
    await ActivityRepository.insert({
      id: activityId,
      organizationId,
      type: input.type,
      subject,
      body,
      occurredAt: new Date().toISOString(),
      dueAt: input.type === "TASK" && dueAt ? dueAt.toISOString() : null,
      companyId: target.companyId,
      contactId: target.contactId,
      dealId: target.dealId,
      createdById: run.initiatedById ?? run.agentCreatedById,
      meta: {
        source: "agent",
        agentId: run.agentId,
        runId,
        actionId: claimed.action.id,
      },
    });
    await AgentRunRepository.finishAction(
      organizationId,
      claimed.action.id,
      claimed.claimedAt,
      { status: "SUCCEEDED", externalId: activityId },
    );
  } catch (error) {
    return fail(organizationId, claimed, "ACTION_REJECTED", error);
  }
  return { actionId: claimed.action.id, activityId, replayed: false };
}

/**
 * Posts to the one Slack destination the version approved, once per tool
 * call. Slack's own message id is the receipt.
 */
async function postSlackMessage(
  organizationId: string,
  runId: string,
  callId: string,
  input: { text: string },
) {
  const { run, manifest, scope } = await activeRun(organizationId, runId);
  const slackGranted = manifest.dataScope.resources.some(
    (resource) =>
      resource.kind === "integration" && resource.id === SLACK_RESOURCE.id,
  );
  const destination = slackDestinationOf(manifest);
  if (!slackGranted || !destination) {
    throw new RunRefusal("This agent version does not allow Slack.");
  }
  void scope;
  const text = input.text.trim();
  if (!text) throw new RunRefusal("A Slack message needs text.");
  const claimed = await claim(organizationId, {
    agentId: run.agentId,
    runId,
    callId,
    request: { destinationId: destination.id, text },
    type: AGENT_ACTION_TYPES.SLACK_MESSAGE_POST,
    provider: "slack",
    targetType: destination.kind,
    targetId: destination.id,
    targetLabel: destination.label,
    summary: `Post a message to ${destination.label}`,
    metadata: { clientMessageId: crypto.randomUUID() },
  });
  if (!claimed.claimed) {
    return {
      actionId: claimed.action.id,
      messageId: claimed.action.externalId,
      destination: destination.label,
      replayed: true,
    };
  }
  const { action, claimedAt } = claimed;
  const clientMessageId =
    typeof action.metadata === "object" &&
    action.metadata !== null &&
    "clientMessageId" in action.metadata &&
    typeof action.metadata.clientMessageId === "string"
      ? action.metadata.clientMessageId
      : action.id;
  let messageId: string;
  try {
    const posted = await SlackService.postMessage(
      organizationId,
      destination,
      text,
      clientMessageId,
      async () => {
        // Last check before anything leaves: still this run's to send.
        if (!(await AgentRunRepository.holdsAction(organizationId, action.id, claimedAt))) {
          throw new RunRefusal("This agent run is not active.");
        }
      },
    );
    messageId = `${posted.channel}:${posted.ts}`;
  } catch (error) {
    const code =
      error instanceof SlackError &&
      ["not_connected", "missing_scope", "invalid_auth", "token_revoked"].includes(error.code)
        ? "NOT_AUTHORISED"
        : error instanceof RunRefusal
          ? "ACTION_REJECTED"
          : "PROVIDER_ERROR";
    return fail(organizationId, claimed, code, error);
  }
  const completed = await AgentRunRepository.finishAction(
    organizationId,
    action.id,
    claimedAt,
    { status: "SUCCEEDED", externalId: messageId },
  );
  if (!completed) {
    await AgentRunRepository.noteDeliveredOutsideClaim(
      organizationId,
      action.id,
      messageId,
      "Slack accepted this message after the run stopped, and it cannot be withdrawn.",
    );
    throw new RunRefusal(
      "This agent run stopped while Slack was accepting the message.",
    );
  }
  return {
    actionId: action.id,
    messageId,
    destination: destination.label,
    replayed: false,
  };
}

/**
 * finish_run: stages the run's summary and result; the run succeeds when its
 * session ends. "No action needed" is refused for a manual run whose version
 * declares an action.
 */
async function stageResult(
  organizationId: string,
  runId: string,
  input: {
    summary: string;
    result?: Record<string, unknown> | null;
    noActionNeeded?: { reason: string } | null;
  },
) {
  const { run } = await activeRun(organizationId, runId);
  if (input.noActionNeeded) {
    const refusal = AgentRunService.noActionRefusal(
      run.triggerType,
      run.manifest,
    );
    if (refusal) throw new RunRefusal(refusal);
  }
  const staged = await AgentRunRepository.stageResult(organizationId, runId, {
    summary: input.summary,
    result: input.result ?? {},
    noActionNeeded: input.noActionNeeded?.reason ?? null,
  });
  if (!staged) throw new RunRefusal("This agent run is not active.");
  return {
    staged: true,
    note: "Recorded. The run finishes when you stop: reply with the same summary and call nothing else.",
  };
}

export const RunActions = {
  runContext,
  queryCrm,
  listDeals,
  readRecord,
  createActivity,
  postSlackMessage,
  stageResult,
};
