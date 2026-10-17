import { ActivityRepository } from "@/server/features/activities/repositories/ActivityRepository";
import { SlackError } from "@/server/features/slack/lib/slackApi";
import { SlackService } from "@/server/features/slack/services/SlackService";
import type { RecordKind } from "@/shared/records";
import {
  AGENT_ACTION_TYPES,
  SLACK_RESOURCE,
  slackDestinationOf,
} from "@/shared/team-agents";
import {
  AgentActionRepository,
  type ActionRow,
} from "../repositories/AgentActionRepository";
import { BuilderRepository } from "../repositories/BuilderRepository";
import { activeRun, inScope, RunRefusal } from "./runActions";

// What a team agent's run does outside itself, ported from the CRM's
// run-runtime.ts: a CRM note or task, a Slack message. Each is granted by
// the deployed version (re-checked here on every call, whatever the model
// asked) and is a row in the action ledger before it happens, keyed by the
// run and the model's tool call, so a replayed call finds what it already did
// instead of doing it twice.

const ACTION_LEASE_MS = 5 * 60_000;

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
    Parameters<typeof AgentActionRepository.planAction>[0],
    "organizationId" | "idempotencyKey" | "requestHash"
  > & { callId: string; request: unknown },
): Promise<Claim> {
  const idempotencyKey = `${input.runId}:${input.callId}`;
  const requestHash = await sha256(input.request);
  const { callId: _callId, request: _request, ...values } = input;
  const action = await AgentActionRepository.planAction({
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
  const claimedAt = await AgentActionRepository.claimAction(
    organizationId,
    action.id,
    ACTION_LEASE_MS,
  );
  if (claimedAt) return { claimed: true, action, claimedAt };
  const current = await AgentActionRepository.findAction(
    organizationId,
    idempotencyKey,
  );
  if (current?.status === "SUCCEEDED")
    return { claimed: false, action: current };
  throw new RunRefusal("This agent action is already in progress.");
}

async function fail(
  organizationId: string,
  claimed: Extract<Claim, { claimed: true }>,
  code: string,
  error: unknown,
): Promise<never> {
  const message = error instanceof Error ? error.message : String(error);
  await AgentActionRepository.finishAction(
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
    if (
      !(await AgentActionRepository.holdsAction(
        organizationId,
        claimed.action.id,
        claimed.claimedAt,
      ))
    ) {
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
    await AgentActionRepository.finishAction(
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
        if (
          !(await AgentActionRepository.holdsAction(
            organizationId,
            action.id,
            claimedAt,
          ))
        ) {
          throw new RunRefusal("This agent run is not active.");
        }
      },
    );
    messageId = `${posted.channel}:${posted.ts}`;
  } catch (error) {
    const code =
      error instanceof SlackError &&
      [
        "not_connected",
        "missing_scope",
        "invalid_auth",
        "token_revoked",
      ].includes(error.code)
        ? "NOT_AUTHORISED"
        : error instanceof RunRefusal
          ? "ACTION_REJECTED"
          : "PROVIDER_ERROR";
    return fail(organizationId, claimed, code, error);
  }
  const completed = await AgentActionRepository.finishAction(
    organizationId,
    action.id,
    claimedAt,
    { status: "SUCCEEDED", externalId: messageId },
  );
  if (!completed) {
    await AgentActionRepository.noteDeliveredOutsideClaim(
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

export const RunSideEffects = {
  createActivity,
  postSlackMessage,
};
